# SEC-1 CI 후속 조치 (2026-11-28)

대상: [SEC-1 1차 감사](../audits/sec-1-2026-11-28/README.md)의 CI·배포 항목 SEC-1-02·03·04·07·08·09 · 결정 D-102 · 기준 `main` `edc2fbf`

## 1. SEC-1-03 실패 잠금 (수정)

CI-1.2 구현에서 확인한 해제 경로:

| 경로 | 원인 | 수정 |
|---|---|---|
| 실행 기록 창 밖으로 밀려남 | 최근 30개만 조회 → 실패 뒤 건너뛴 실행이 30개를 넘으면 실패가 보이지 않음 | 마지막 수동 배포 이후의 실행을 **모든 페이지** 조회(`created>` 필터), 1,000개 초과·조회 오류 시 정지 |
| 재실행 | 실패한 자동 실행을 다시 실행해 성공하면 결론이 success로 바뀜 | 자동 `release` 작업이 `run_attempt != 1`이면 실패. 재실행 흔적(`run_attempt > 1`)은 그 자체로 잠금 |
| 배포 중 취소 | `cancelled`를 무시 | 배포 단계가 시작된 뒤 취소된 실행은 잠금. 대기 중 교체된 실행처럼 배포 단계 전에 취소된 것은 제외 |
| 배포하지 않은 수동 실행 | 수동 실행이 초록이기만 하면 해제 | `deploy` 작업이 success인 첫 시도(run_attempt 1)의 수동 실행만 복구로 인정 |
| 그 밖의 결과 | `timed_out`, `startup_failure` 무시 | 잠금 |

정상 복구 절차는 그대로다: 원인 확인 → 수동 워크플로(`worker-production-approval` 승인) 성공 → 자동 재개. 코드 `scripts/ci/worker-release-lock.mjs`, 테스트 `tests/ci-worker-release.test.ts` "release lock".

## 2. SEC-1-04 빌드와 운영 토큰 분리 (수정)

| 작업 | 자격 증명 | 하는 일 |
|---|---|---|
| 자동 `prepare` / 수동 `verify` | 없음 | `npm ci`(설치 스크립트 포함), Worker 번들 빌드(`wrangler deploy --dry-run --outdir`), Worker 입력 목록, `release.json`(커밋·SHA-256·크기) → 같은 실행의 아티팩트 |
| 자동 `release` / 수동 `deploy` | `worker-production` 토큰 | `npm ci --ignore-scripts`(Wrangler만, 캐시 복원 없음), 아티팩트 내려받기, **커밋·스키마·파일 목록·SHA-256 검증**, 쓰기 직전 해시 재확인, `wrangler deploy <bundle> --no-bundle` |

토큰 작업은 저장소 빌드 코드와 의존성 설치 스크립트를 실행하지 않는다. 배포 파일은 같은 실행의 무자격 작업이 만든 것뿐이며, Summary에 번들 SHA-256을 기록한다. 로컬 확인: 사전 빌드 번들을 `--no-bundle`로 올리는 업로드 내용이 기존 빌드와 바이트 단위로 같고(401.29 KiB, DO 바인딩 6개 동일), `--ignore-scripts` 설치로도 Wrangler가 동작한다. 남는 경계: 토큰 작업은 main의 배포 스크립트(`scripts/ci/*.mjs`)와 잠금 파일의 Wrangler를 실행한다 → main 보호(PR·`ci-result`)와 `worker-production`의 main 전용 규칙이 그 경계다.

## 3. CI Low 항목

| ID | 조치 |
|---|---|
| SEC-1-07 | 연구 워크플로 4개(`competitive-research`, `confirm-v2`, `frontier-200k`, `v5-apex-research`)의 `inputs.*`를 `run:`에 직접 넣지 않고 `env:`로 전달, 숫자·이름 형식 검증 |
| SEC-1-08 | `online-live-check`의 PR 라벨 실행은 같은 저장소 브랜치만(포크 PR 제외) |
| SEC-1-09 | Wiki 동기화 토큰을 URL 대신 HTTP 헤더(`GIT_CONFIG_*` 환경 변수, argv 미노출)로 전달, 오류 메시지의 URL 자격 증명 제거 |

## 4. SEC-1-02 구형 Cloudflare 시크릿 (해결됨, 2026-11-28)

| 항목 | 확인 결과 |
|---|---|
| main 워크플로 | 저장소 시크릿 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 참조 **없음**. `worker-production` Environment 시크릿(`WORKER_PRODUCTION_*`)만 사용 |
| 다른 브랜치 | 원격 브랜치 약 70개에 이전 `deploy-online-worker.yml`(저장소 시크릿 사용)이 남아 있다. 같은 파일 이름이 기본 브랜치에 있으므로 쓰기 권한자가 `ref=<옛 브랜치>`로 실행하면 **Environment를 거치지 않고** 구형 토큰으로 배포할 수 있다. 실제로 수동 실행 #14~#16(2026-11-25)은 기능 브랜치에서 실행됐다 |
| 구형 토큰 마지막 사용(Actions) | 수동 #17 [45772443229](https://github.com/oyueo-mm/YachtLab/actions/runs/45772443229)(2026-11-26, `54c1367`) |
| 신규 토큰 성공 기록 | 읽기 점검 [46101611304](https://github.com/oyueo-mm/YachtLab/actions/runs/46101611304), 수동 배포 #18 [46103873770](https://github.com/oyueo-mm/YachtLab/actions/runs/46103873770)·#19 [46113118303](https://github.com/oyueo-mm/YachtLab/actions/runs/46113118303), 첫 자동 실행 [46117886454](https://github.com/oyueo-mm/YachtLab/actions/runs/46117886454)(Worker 입력 변경 없음 → Cloudflare 읽기 후 건너뜀, 활성 `27ff426a…` 유지) |
| 결론 | 구형 토큰에 대한 main의 의존성 없음. 남아 있는 한 우회 경로이므로 폐기 대상 |
| **조치(운영자, 2026-11-28)** | Cloudflare의 구형 "YachtLab Deploy" 토큰 폐기, 저장소 시크릿 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID` 삭제(Repository secrets 비어 있음). "YachtLab Production Deploy" 토큰과 `worker-production` Environment 시크릿 2개는 유지 |
| **확인** | 삭제 후 읽기 점검 [46123593845](https://github.com/oyueo-mm/YachtLab/actions/runs/46123593845) 성공(활성 `27ff426a…` 100%), 이어서 자동 배포 [46123739813](https://github.com/oyueo-mm/YachtLab/actions/runs/46123739813)이 신규 토큰으로 #137을 배포. 옛 브랜치의 구형 워크플로는 시크릿이 없어 더 이상 배포할 수 없다 |

폐기 절차(기록용, 2026-11-28 수행 완료):
1. [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)에서 이 저장소 배포용 **구형** 토큰을 찾는다(이름·생성일·마지막 사용 시각으로 구분, `worker-production`용 신규 토큰과 혼동 금지). 마지막 사용이 2026-11-26 이후 Actions 기록과 맞지 않으면 중단하고 확인한다. 다른 프로젝트의 토큰은 건드리지 않는다.
2. 그 토큰을 **Roll이 아닌 Delete(폐기)** 한다.
3. [Actions secrets](https://github.com/oyueo-mm/YachtLab/settings/secrets/actions) → Repository secrets에서 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`를 삭제한다. Environment secrets(`WORKER_PRODUCTION_*`)는 유지.
4. [읽기 점검](https://github.com/oyueo-mm/YachtLab/actions/workflows/verify-worker-production-read.yml)을 현재 활성 UUID로 실행해 신규 토큰이 정상인지 확인한다(또는 다음 자동 실행 Summary 확인).

## 5. SEC-1-01 수정 출시 (완료)

| 항목 | 결과 |
|---|---|
| 병합 | [#137](https://github.com/oyueo-mm/YachtLab/pull/137) → main `331b5c9cb26ba761de71f07a273b378c6d5c2e17`, PR CI [46121993035](https://github.com/oyueo-mm/YachtLab/actions/runs/46121993035) 성공 |
| 배포 전 | 읽기 점검 [46122981444](https://github.com/oyueo-mm/YachtLab/actions/runs/46122981444): 활성 `27ff426a…` 100% |
| Pages | main CI·배포 [46123011195](https://github.com/oyueo-mm/YachtLab/actions/runs/46123011195), `331b5c9-mx0426s4` |
| Worker(자동, CI-1.2 첫 실제 배포) | [46123739813](https://github.com/oyueo-mm/YachtLab/actions/runs/46123739813): 변경 입력 `worker/src/account.ts`, 배포 `c13d98b7-b61f-4acc-a30f-e3acaff93379`, **활성 100% `6ef2c717-60f1-48c0-89ee-3b7ae8b0f1de`**, 복귀 후보 `27ff426a-9cf0-4fea-bcc8-6ad84fb05df0`(배포 `f541a6f2…`) |
| 운영 점검 | `/healthz` ok, 기능 플래그 전체, 로그인 설정, 게스트 2인 친구 방 생성·입장·양쪽 1턴·관전 설정·재접속·기권 결과 창, 페이지 오류 0. 계정·재화 데이터는 건드리지 않았다(과거 기록 소급 수정 없음) |

### 권장 순서 (작성 당시)

SEC-1-01 브랜치 `claude/eager-pasteur-2oqfw7`(`185c504`) 검토: 변경은 `AccountStore.insert` 한 곳이다. 같은 ID에 클라이언트 보고 행만 있을 때 서버 검증 기록이 그 행을 지우고 다시 넣으며, 기존 기록·정산 트랜잭션(`econSql().transaction`) 안에서 실행되어 정산 실패 시 함께 롤백된다. 기기 사본은 리뷰 아카이브를 쓰지 않으므로 남는 행이 없다. 스키마·원장 키·보상량 변경 없음. 회귀 테스트가 정산 1회, 재배달 멱등, 이후 기기 업로드 무시를 확인한다. 문제 없음.

1. **SEC-1-01 PR을 먼저 병합한다**(이 CI PR을 기다리지 않는다). `worker/src/account.ts`는 보호 입력이 아니므로 현재 main의 CI-1.2 자동 경로로 배포된다: main CI → Pages → 자동 Worker 배포. 현재 잠금 대상 실패가 없으므로 SEC-1-03 결함의 영향을 받지 않는다.
2. 자동 실행 Summary에서 새 UUID·롤백 버전을 확인하고, 공개 점검(`/healthz`·기능 플래그)을 본다. 클라이언트 변경이 없어 Pages 호환 문제는 없다.
3. 이후 이 CI PR을 병합한다. 병합 커밋은 Worker 입력을 바꾸지 않으므로 첫 자동 실행은 새 구조(prepare → release)로 Cloudflare를 읽고 건너뛴다(경로 점검).
4. 두 PR은 `docs/context/DECISIONS.md`·`ROADMAP.md`를 모두 수정한다. 나중에 병합하는 쪽이 main을 합쳐 문서 충돌만 해소한다(D-101 SEC-1-01, D-102 이 PR).
5. 롤백이 필요하면 Cloudflare Deployments에서 직전 버전으로(별도 승인). 롤백 뒤 자동 배포는 스스로 정지하고 수동 배포로만 재개된다.

## 6. SEC-1 Low/Info(#138) 출시 — 새 배포 구조의 첫 실제 쓰기 (2026-11-28)

| 항목 | 결과 |
|---|---|
| 병합 전 | head `31bae0a`(main `083ce9e` 병합본) 필수 CI [46125141385](https://github.com/oyueo-mm/YachtLab/actions/runs/46125141385) 성공(`game-shell.spec.ts:14` 간헐 실패 1회 재실행 — main에서도 24회 중 1회 재현되는 기존 문제), 읽기 점검 [46130510556](https://github.com/oyueo-mm/YachtLab/actions/runs/46130510556) 활성 `6ef2c717…` 100%, 실패 잠금 열림(복구 기준 수동 #19 이후 자동 실행 3건 모두 첫 시도 성공) |
| 병합 | [#138](https://github.com/oyueo-mm/YachtLab/pull/138) → main `d775ecb5a390488f15ac41ce2acc1abeb3801ec9` |
| Pages | [46130543903](https://github.com/oyueo-mm/YachtLab/actions/runs/46130543903) → `d775ecb-mx07j30u` |
| Worker 자동 배포 | [46131383157](https://github.com/oyueo-mm/YachtLab/actions/runs/46131383157): 변경 입력 `src/online/room.ts`·`worker/src/index.ts` |
| 자격 증명 없는 빌드 | `prepare` 작업(시크릿 없음)이 번들 빌드·`release.json` 작성: `bundle/index.js` sha256 `5219006a281c45a9dff65d7cb747546636f114d8f30cad031110e32dd77c5761`(411,192 bytes), DO 바인딩 6개 그대로 |
| 토큰 작업 | 재실행 거부 검사 통과, `npm ci --ignore-scripts`, 아티팩트 커밋·SHA-256 검증, 쓰기 직전 재확인, `wrangler deploy <bundle> --no-bundle` |
| 배포 결과 | 배포 `30c5c433-49ff-4acd-9c82-2f0c452463bf`, **활성 100% `692e00a4-d983-4ccb-b93c-4e52c06deca6`**, 복귀 후보 `6ef2c717-60f1-48c0-89ee-3b7ae8b0f1de`(배포 `c13d98b7…`); 독립 읽기 점검 [46132008550](https://github.com/oyueo-mm/YachtLab/actions/runs/46132008550) 일치 |
| 운영 점검 | `/healthz` ok, 기능 플래그 전체, 로그인 설정, 게스트 2인 친구 방(생성·입장·양쪽 1턴·관전 설정·재접속·기권 결과 창), 페이지 오류 0 |

이로써 SEC-1-01·02·03·04·07·08·09·11·12와 C4 SEC-15(일부)가 운영에 반영됐다. 남은 SEC-1 항목은 [TRIAGE](../audits/sec-1-2026-11-28/TRIAGE.md) 분류를 따른다.
