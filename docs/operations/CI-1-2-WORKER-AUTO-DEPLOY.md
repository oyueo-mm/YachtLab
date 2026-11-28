# CI-1.2 Worker 자동 배포 (2026-11-28)

결정 D-100 · 코드 [`deploy-online-worker-auto.yml`](../../.github/workflows/deploy-online-worker-auto.yml), [`auto-deploy-online-worker.mjs`](../../scripts/ci/auto-deploy-online-worker.mjs), [`worker-release-plan.mjs`](../../scripts/ci/worker-release-plan.mjs) · 테스트 `tests/ci-worker-release.test.ts`

> 같은 이름의 연구 워크플로 정리(CI-1.2, `workflow_dispatch` 전용)와는 별개다. 이 문서는 Worker 배포만 다룬다.

## 1. 일반 제품 업데이트의 흐름

개발 → PR → 필수 `ci-result` → main 병합 → `Test and deploy YachtLab`(테스트·Pages 배포) → **자동 Worker 배포**(Worker 입력이 바뀐 경우만). 운영자 승인·변수 변경이 필요 없다.

| 단계 | 내용 |
|---|---|
| 시작 조건 | `Test and deploy YachtLab`이 **main push**에서 성공(`workflow_run`). PR·예약 실행·실패·취소 실행에서는 시작하지 않는다 |
| 비상 정지 | `WORKER_PRODUCTION_DEPLOY_ENABLED`가 `true`가 아니면 건너뜀(자동). 수동 워크플로도 같은 값으로 막힌다 |
| 번들 검증 | 자격 증명 없이 `wrangler deploy --dry-run` |
| 정지 규칙 | 자동·수동 배포 실행 중 가장 최근 **실패** 이후에 **수동 배포 성공**이 없으면 **정지**. 성공한 자동 실행(비상 정지·변경 없음·main 이동으로 건너뛴 실행 포함)은 잠금을 풀지 않는다 |
| 기준점 | Cloudflare 100% 활성 버전의 주석 `git:<sha> actions:<run>/<attempt>`(이 파이프라인의 배포 기록). 주석이 없으면(대시보드 배포·롤백) **정지** |
| 변경 판정 | 활성 배포 커밋 → 이번 커밋 diff ∩ Worker 입력. Worker 입력 = `worker/src/index.ts`의 esbuild 번들 입력(타입 전용 import 제외) + `worker/wrangler.toml`·`worker/tsconfig.json`(번들에 npm 패키지가 생기면 `package*.json`도). 없음 → **건너뜀** |
| 보호 입력 | `worker/wrangler.toml`(바인딩·DO 마이그레이션·런타임 변수·정리 플래그), `worker/src/economy.ts`, `src/economy/live/{config,rewards,draw}.ts` → **정지**, 수동 배포 |
| 순서 | main이 이미 다음 커밋이면 건너뜀(다음 실행이 배포). 운영 Pages `version.json`이 이 커밋이 될 때까지 최대 10분 대기(Pages 먼저) |
| 배포 | 기존 `deploy-online-worker.mjs` 재사용: 쓰기 직전 활성 버전·Pages 빌드·main tip 재확인, 배포 ID·새 UUID·롤백 버전을 Summary에 기록, 공개 헬스·기능·로그인 점검 |
| 동시성 | 수동·자동 공통 그룹 `yachtlab-online-worker-deploy`, 진행 중 취소 없음 |
| 실패 | 재시도하지 않는다. 실패 실행이 남아 이후 자동 배포를 정지시킨다. 원인 확인 뒤 수동 워크플로로 한 번 배포하면 재개된다 |

UI·문서만 바뀐 커밋은 Cloudflare에 쓰지 않는다(읽기 1회 후 "No Worker input changed"). 중간 커밋이 취소·건너뜀이어도 다음 성공 실행이 활성 배포 커밋 기준으로 누적 변경을 배포한다.

## 2. 수동 경로 = 고위험 배포 (별도 운영자 승인 유지)

[`deploy-online-worker.yml`](https://github.com/oyueo-mm/YachtLab/actions/workflows/deploy-online-worker.yml) — 보호 입력 변경(경제 정책·DO 마이그레이션·바인딩·런타임 변수), 롤백 뒤 첫 배포, 자동 정지 해제, 그 밖의 운영자 배포. 입력(`free_plan_confirmed`, `reviewed_sha`, `pages_build`, `active_worker_version`)과 검증은 그대로다.

`verify`(자격 증명 없음) → **`approve`**(Environment `worker-production-approval`, Required reviewers, 시크릿 없음) → `deploy`(`worker-production`, 전용 토큰). `approve`는 자기 Environment에 리뷰어 규칙이 실제로 있는지 API로 확인하고 없으면 실패한다(삭제된 Environment를 GitHub가 무보호로 다시 만드는 경우 차단). 자동 경로는 이 Environment를 쓰지 않는다.

## 3. 별도 승인으로 남는 것

DB(Durable Object) 마이그레이션·바인딩·런타임 변수 변경(보호 입력 → 수동), 대량 데이터 삭제(`FRIEND_RESIDUE_CLEANUP` 등), 경제 정책 변경(보호 입력 + PR 검토), 유료 서비스·결제 설정, 실제 롤백(Cloudflare Deployments). main 보호·필수 `ci-result`, `worker-production` Environment의 main 전용 배포 규칙과 전용 API 토큰은 그대로다.

## 4. 운영자 1회 설정

1. [Environments → worker-production](https://github.com/oyueo-mm/YachtLab/settings/environments) → **Deployment protection rules**에서 **Required reviewers** 체크 해제 → **Save protection rules**. **Deployment branches and tags**의 `main` 규칙과 Environment secrets(`WORKER_PRODUCTION_API_TOKEN`, `WORKER_PRODUCTION_ACCOUNT_ID`)는 그대로 둔다.
2. 같은 화면 **Environment variables** → `WORKER_PRODUCTION_DEPLOY_ENABLED` = `true`. 이제 상시 값이며, 비상시에만 `false`로 바꾼다.

3. (수동 배포 전에) [New environment](https://github.com/oyueo-mm/YachtLab/settings/environments/new) → 이름 `worker-production-approval` → **Required reviewers**에 운영자 지정 → **Deployment branches and tags: Selected → main** → Save. 시크릿·변수는 넣지 않는다. 설정 전에는 수동 배포가 `approve`에서 실패한다(안전한 기본값).

1·2는 2026-11-28 완료. 이 PR의 병합 커밋은 Worker 입력을 바꾸지 않으므로 첫 자동 실행은 Cloudflare를 읽기만 하고 "건너뜀"으로 끝난다(경로 전체의 실제 점검).

## 5. 비상 정지·해제

- 정지: `WORKER_PRODUCTION_DEPLOY_ENABLED=false` → 자동은 건너뜀, 수동은 실패. 건너뛴 자동 실행은 기존 실패 잠금을 풀지 않는다.
- 롤백(별도 승인): Cloudflare Deployments에서 직전 버전 Rollback. 롤백 배포에는 파이프라인 주석이 없어 자동 배포가 스스로 정지한다. 수정 커밋을 수동 워크플로로 배포하면 재개.
- 자동 실행 실패 후: Summary와 Cloudflare Deployments를 확인하고, 필요하면 수동 워크플로로 배포(성공하면 자동 재개).
