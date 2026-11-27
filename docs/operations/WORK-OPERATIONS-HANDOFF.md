# YachtLab 운영 인수인계 — C4.1과 C0

2026-11-28 KST · 다음 담당자 ChatGPT Work · **Worker 배포 보류**

이 문서의 순서대로 읽기 점검을 먼저 끝낸다. GitHub·Cloudflare 설정 변경, 시크릿 생성·등록·삭제·회전, PR 병합, 운영 배포·롤백, 운영 테스트 쓰기와 전체 세션 만료는 각각 운영자가 승인한 범위에서만 실행한다. 승인 기록에는 대상 계정과 서비스, 작업과 범위, 승인자·시각, 대상 SHA 또는 버전, 중단 조건을 남긴다. 실제 로그·계정·요청 값과 시크릿은 문서, 채팅, 커맨드 출력, 스크린샷이나 CI에 복사하지 않는다.

## 운영 기준점과 PR 관계

| 항목 | 확인 결과 |
| --- | --- |
| GitHub Pages | 공개 `version.json` 재조회 결과 `db2e17a-mwz88q0x`. 소스 `db2e17a`에는 강화 Hotfix #119가 포함된다. 이 값은 현재 탭이나 PWA가 캐시한 버전과 다를 수 있다. [Pages 버전](https://oyueo-mm.github.io/YachtLab/version.json) |
| Cloudflare Worker | 운영자가 확인한 활성 UUID `900728c2-c252-4dc7-be9f-0b698826eca7`, 트래픽 100%. 소스 `54c13679f04e11c13efd2d0e7d3a7b412d86167b`와 기존 성공 배포 기록이 일치한다. [배포 기록](https://github.com/oyueo-mm/YachtLab/actions/runs/45772443229) |
| C0 #112 | 열려 있는 운영 검증 보고서. 로컬 Worker 교체·롤백과 기존 계정·재화 보존 근거를 제공한다. 운영 데이터에 대한 검증과 승인 상태는 이어지는 체크리스트를 따른다. [C0 #112](https://github.com/oyueo-mm/YachtLab/pull/112) |
| Hotfix #119 | 병합됐다. Pages가 구 Worker에서 지원하지 않는 보드 강화와 상품을 안내하고 지원 판을 확인한다. Worker의 신규 단계·판매·1인 기록 동기화를 활성화하는 작업은 C0 승인 배포에 남아 있다. [Hotfix #119](https://github.com/oyueo-mm/YachtLab/pull/119) |
| C4 #121 | 감사 근거와 후속 백로그를 담은 열린 PR이다. SEC-01의 운영 관측 갱신은 #123 문서를 따른다. [감사 #121](https://github.com/oyueo-mm/YachtLab/pull/121) |
| C4.1 #123 | `codex/c4-1-worker-deploy-readiness`의 열린 초안 PR. 호출 로그·트레이스 중단, URL 쿼리 마스킹, 고정 오류 코드, Worker 배포 통제, 워크플로 변경 시 전체 CI를 제안한다. #112와 #121의 문서 병합은 이 통제의 기술적 선행 조건이 아니다. [C4.1 #123](https://github.com/oyueo-mm/YachtLab/pull/123) |

### 완료한 검증

- 인수인계 문서 추가 전 #123 헤드 `b49643d`의 GitHub CI에서 `scope`, `unit`, `build`, Playwright 4개 샤드, `ci-result`가 성공했다. PR에서 Pages `deploy`는 건너뛰었고 Context sync의 PR 검증 `check`는 성공했다. 인수인계 커밋을 포함한 최신 결과는 PR Checks를 기준으로 한다. [전체 CI](https://github.com/oyueo-mm/YachtLab/actions/runs/46041612397) · [Context sync](https://github.com/oyueo-mm/YachtLab/actions/runs/46041612449) · [최신 PR Checks](https://github.com/oyueo-mm/YachtLab/pull/123/checks)
- 로컬 빌드, Vitest 545개, 관련 Playwright 41개(기존 조건부 7개 건너뜀), actionlint, Wrangler dry-run, 모의 릴리스 8개가 통과했다. C0 교체 및 데이터 보존 실험과 #119의 경제 호환 실험은 기존 결과를 재사용한다. [C4.1 배포 준비 보고서](./C4-1-WORKER-DEPLOY-READINESS.md)
- 최신 `main` `31dbc508b6dc37549589e9a643e4999eb98ae2dd` 기준으로 #123과의 병합을 시뮬레이션했다. 열린 #112·#113·#118·#121·#122·#124·#126과도 충돌이 없었다. #118·#124는 Worker 진입점, #126은 Pages CI, 여러 PR은 결정 문서를 함께 수정하므로 병합 순서가 바뀌면 통합 diff와 CI를 확인한다. #120은 `DECISIONS.md`와 `HANDOFF.md`, #125는 `DECISIONS.md`에서 이미 `main`과 충돌한다. #123을 합친 경우에도 해당 파일의 충돌이 재현됐다. [열린 PR](https://github.com/oyueo-mm/YachtLab/pulls)

### 운영자가 이미 확인한 상태

Workers Free, 위 Worker UUID와 100% 트래픽, 이전 버전 보존 및 Rollback 메뉴 표시, 운영 변수와 `wrangler.toml` 일치, `AUTH_SECRET`·`GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET` 등록, Durable Objects 바인딩 6개 일치가 확인됐다. 인증 표본의 `Authorization`은 마스킹됐고 IP 및 위치 메타데이터는 원문 수집이 확인됐다. 현재 활성 배포가 바뀌었거나 설정 변경 이력이 생기는 등 기준이 달라졌을 때 해당 항목을 다시 확인한다. 최종 승인 직전에는 실행에 사용할 공개 Pages 빌드와 Worker 버전 식별자의 최신성만 대조한다.

남은 확인은 Observability 상세 설정과 외부 전송, 결제 및 구독, 실제 롤백 실행 권한과 운영 데이터 보존이다. 메뉴 표시는 권한·실행 성공의 근거로 사용하지 않는다. 운영 기록·재화·인벤토리 보존은 승인된 테스트 계정과 집계 결과로만 확인한다.

## 적용 순서와 성공 기준

| 순서 | 주체와 선행 조건 | 성공 기준 |
| --- | --- | --- |
| 1. Cloudflare 읽기 점검 | 운영자가 대상 계정에 열린 세션과 읽기 권한을 제공한다. | Observability·전송·보존, 결제·구독, 롤백 담당자의 권한 상태를 값 없이 기록한다. |
| 2. GitHub Environment 준비 | 설정 변경 승인 후. 배포 활성화 변수를 미설정 또는 `false`로 유지한다. | `worker-production`의 Branch `main` 제한과 승인 정책이 저장돼 있다. |
| 3. Context sync 전환 및 main 보호 | 별도 승인으로 생성 문서 갱신 경로를 정한 뒤 진행한다. | PR 경로로 스냅샷이 갱신되고 `ci-result`가 정상 적용된다. 직접 푸시, 강제 푸시, 브랜치 삭제가 제한된다. |
| 4. 배포 시크릿 전환 | Environment 정책과 배포 중단 상태를 확인한 뒤 시크릿 작업을 승인받는다. | 새 권한은 지정 Environment에 있고, 기존 브랜치에서 사용할 수 있던 운영 자격은 제거 또는 폐기됐다. 런타임 시크릿은 기존 바인딩을 사용한다. |
| 5. PR 및 릴리스 검토 | 최신 main과 PR의 CI가 성공한 뒤 #123 병합을 별도로 승인받는다. 설정·코드·트래픽 변경 이력을 확인한다. | 검토한 최종 main SHA, Pages 빌드와 Worker 100% UUID, 작업 시간과 롤백 담당자를 기록했다. |
| 6. 운영 Worker 출시 | 운영자가 대상 SHA의 배포 및 필요 시 사용할 롤백 범위를 명시 승인한 뒤 진행한다. | Worker 배포 ID와 100% 버전이 Actions Summary와 일치하고, 방·기록·경제·로그 검증을 통과한다. |

### Cloudflare 대시보드 읽기 점검

1. [Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)에서 기존 계정의 `yachtlab-online`을 연다. **Settings → Observability**와 **Observability**에서 Logs, Invocation logs, 쿼리 제거, 샘플링, 트레이스 및 Issues 상태를 확인한다. 호출 이벤트와 오류 코드의 유형·집계 및 보존 기간만 기록한다. OAuth 콜백의 `code`·`state`가 요청 URL과 함께 기록될 가능성이 있으므로, 운영 고객 요청 대신 집계 필드나 승인된 격리 환경의 합성 표식으로 확인한다. Cloudflare 관리형 Free Observability는 2026-12-01부터 7일 보존·공용 하루 0.5 GB 한도로 전환될 예정이다. 적용 시점의 표시를 확인한다. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [Observability 요금](https://developers.cloudflare.com/observability/pricing/)
2. 같은 Worker의 내보내기 설정과 계정 수준 로그 대상을 확인한다. Logpush, Tail Workers, OTLP, 외부 대상의 사용 여부, 접근 범위와 보존 정책을 기록한다. 각 경로의 쿼리·헤더 마스킹 보장은 별도로 확인한다. 접근할 수 없는 대상은 미확인으로 남기고 원문 로그 접근은 요청하지 않는다. [Cloudflare 내보내기](https://developers.cloudflare.com/observability/export/) · [Workers 실시간 로그](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/)
3. [Cloudflare 대시보드](https://dash.cloudflare.com/) → **Manage Account → Billing → Subscriptions / Billable Usage**에서 해당 계정의 유료 Workers·유료 로그 상품, 결제 활성 여부, 공유 한도 여유를 확인한다. 계정 링크는 로그인 후 생성되는 계정별 경로를 사용한다. 결제 상태가 불명확하거나 업그레이드·새 유료 리소스가 필요하면 보류한다. [결제 화면 안내](https://developers.cloudflare.com/billing/understand/how-billing-works/)
4. **Workers & Pages → yachtlab-online → Deployments**에서 운영자가 확인해 둔 기준점과 변경 여부를 대조한다. [Cloudflare 멤버 관리](https://dash.cloudflare.com/)의 **Manage Account → Members**에서 지정 운영자의 Worker 배포 권한 범위를 확인한다. 기존 버전 보존 및 메뉴 표시는 이미 확인했으므로 권한 점검을 위해 롤백을 실행할 필요는 없다. 화면 확인과 실제 롤백 검증을 개별 상태로 남긴다. [Worker 역할](https://developers.cloudflare.com/workers/authorization/workers/) · [롤백](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

### GitHub Environment와 단독 운영자 승인

1. [Environments](https://github.com/oyueo-mm/YachtLab/settings/environments)에서 **New environment → worker-production**을 만든다. **Deployment branches and tags → Selected branches and tags → Add deployment branch or tag rule → Branch → main**을 저장한다. 태그와 다른 브랜치 규칙은 비워 둔다. `github-pages`의 기존 설정은 별도 작업으로 취급한다.
2. **Required reviewers**를 활성화하고 정상 승인자를 지정한다. 관리자 보호 규칙 우회를 끈다. 현재 공개 저장소는 GitHub Free에서도 Required reviewers를 지원한다. 독립 승인자가 있으면 해당 승인자를 지정하고 **Prevent self-review**를 켠다. [GitHub Environment 설정](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
3. **단독 운영 시 권장.** 소유자를 Required reviewer로 지정하고 Prevent self-review를 끈다. 소유자는 수동 실행 후 테스트가 성공한 별도의 대기 잡에서 **Review deployments**로 대상 SHA와 운영자 승인 기록을 대조한 뒤 승인한다. 같은 사람이 두 행위를 수행하는 방식이며 독립 검토는 제공하지 않는다. 이 방식에서는 PR 필수 일반 리뷰 인원을 강제하지 않아 작성자 혼자서도 CI를 통과한 PR을 처리할 수 있다. [배포 승인 화면 안내](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)
4. Required reviewers를 사용할 수 없으면 Environment의 운영 권한을 비워 두고 배포 변수도 비활성으로 유지한다. 대안은 승인 기록·CI·정확한 main SHA를 확인한 후 운영자 본인이 제한된 환경에서 실행하는 승인된 배포다. ChatGPT Work는 소유자의 검토나 승인을 대신 기록하지 않는다.
5. 성공 기준은 Environment 화면에 정확한 브랜치 규칙과 리뷰어가 보이고 우회가 꺼진 상태다. 상태는 설정으로 확인한다. 운영 워크플로의 실제 승인 대기는 별도로 승인된 첫 실행에서 확인한다. [Worker 워크플로](https://github.com/oyueo-mm/YachtLab/actions/workflows/deploy-online-worker.yml)

### Context sync와 main 보호

- 현재 `Context sync`의 `sync` 잡은 `GITHUB_TOKEN`의 `contents: write`로 생성 문서만 커밋하고 `git push origin HEAD:main`을 실행한다. `main`에 PR 필수·우회 금지 규칙을 켜면 이 직접 푸시가 거부된다. 실패 지점은 Wiki 갱신보다 앞이어서 해당 실행의 이후 단계에도 영향을 준다. PR용 `check` 잡은 그대로 유지할 수 있다. [현재 워크플로](../../.github/workflows/context-sync.yml)
- **권장 전환.** 별도 PR에서 생성 스냅샷을 전용 브랜치와 PR로 보내고 변경 파일은 `docs/context/_generated/`로 제한한다. 생성 PR의 커밋에는 현재 직접 푸시에서 쓰는 `[skip ci]`를 빼서 필수 체크를 받는다. 생성 문서만 병합한 뒤 재갱신을 반복하지 않도록 기존 paths-ignore를 유지하고, 필요시 생성 PR/워크플로가 만든 CI 상태를 스냅샷 입력에서 구분한다. 전환을 기다려야 한다면, 운영자 승인으로 생성물을 아티팩트로 확인하거나 직접 PR을 만드는 방식으로 임시 이관한다. 넓은 봇 우회 권한이 필요 없는 경로를 선택한다. [Context sync 실행](https://github.com/oyueo-mm/YachtLab/actions/workflows/context-sync.yml)
- 생성 PR 자동화에 `GITHUB_TOKEN`을 쓰면 [Actions 일반 설정](https://github.com/oyueo-mm/YachtLab/settings/actions)과 잡 권한이 PR 생성을 지원하는지 확인한다. GitHub의 현재 문서에 따르면 이 토큰이 만든 PR 검증은 쓰기 권한자의 수동 CI 실행 승인을 요구할 수 있다. 완전 자동 실행이 꼭 필요할 때만 저장소 한정 GitHub App 설치 토큰을 별도 승인으로 검토한다. 성공 기준은 보호된 `main` 직접 쓰기 없이 생성 PR의 필수 CI를 소유자가 처리할 수 있고, 생성 문서만 변경 및 Wiki 갱신 경로가 확인되는 상태다. [GITHUB_TOKEN과 워크플로 트리거](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- Context sync 전환을 검증한 다음 [브랜치 보호](https://github.com/oyueo-mm/YachtLab/settings/branches) 또는 [Rulesets](https://github.com/oyueo-mm/YachtLab/settings/rules)에서 정확히 `main`을 지정한다. PR 필수, GitHub Actions의 `ci-result` 필수, 최신 base 요구, 관리자 포함 우회 금지, 강제 푸시 및 삭제 금지를 적용한다. 단독 운영에서는 독립 리뷰·마지막 푸시 외부 승인을 필수로 두지 않는다. 현재 CI에 `merge_group` 트리거가 없으므로 merge queue는 사용하지 않는다. 성공 기준은 일반 PR과 생성 PR 모두 해당 체크가 표시되고, PR·CI 없이 `main`을 갱신할 수 없는 설정이 확인되는 것이다. [브랜치 보호 기준](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)

### 배포 시크릿 전환

1. [저장소 Actions 시크릿](https://github.com/oyueo-mm/YachtLab/settings/secrets/actions)에서 **이름과 범위**만 확인한다. 저장소·조직 범위의 기존 Cloudflare 배포 자격, 과거 브랜치의 워크플로, Cloudflare 자체 자동 빌드·CLI/대시보드 쓰기 주체와 기존 자격 의존성을 확인하고 전환 시간을 정한다. 조회 권한이 없으면 운영자가 확인한다.
2. 전환 승인을 받은 뒤 [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens) 또는 계정의 **Manage Account → Account API Tokens**에서 대상 계정과 기존 Worker에 필요한 최소 쓰기 범위로 배포 자격을 마련한다. 운영자만 발급값을 GitHub의 [worker-production 설정](https://github.com/oyueo-mm/YachtLab/settings/environments) → **Environment secrets**에 직접 등록한다. 새 이름은 `WORKER_PRODUCTION_API_TOKEN`, `WORKER_PRODUCTION_ACCOUNT_ID`다. Environment 변수 `WORKER_PRODUCTION_DEPLOY_ENABLED`는 배포 승인 전 비활성이다. [Cloudflare Worker 권한](https://developers.cloudflare.com/workers/authorization/workers/) · [GitHub Environment 시크릿](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
3. 기존 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`의 접근 범위와 의존성을 확인한 뒤 별도 승인된 전환 계획대로 넓은 배포 자격을 제거하고 필요 시 Cloudflare에서 폐기한다. 이전 브랜치의 수동 워크플로가 기존 자격을 쓸 수 있으면 배포 통제가 완료되지 않은 상태다. 앱의 런타임 시크릿은 Cloudflare Worker에 그대로 둔다. 성공 기준은 새 자격이 Environment에 한정되고 예전 브랜치 또는 공유 시크릿 경로에서 운영 쓰기가 불가능함을 이름·정책으로 확인하는 것이다.

## 승인된 Worker 배포와 롤백

1. **배포 전.** #123 병합 이후 현재 `main` SHA를 검토하고 필수 CI 성공을 확인한다. Pages의 현재/직전 번들이 기존 기능과 호환되는지 확인한다. Cloudflare 쓰기·롤백 권한, Billing 결과, 외부 로그 전송, Worker 활성 UUID, 기존 데이터 및 테스트 계정 기준값을 점검표에 남긴다. 온라인 방이 한산한 시간을 선택하고 진행 중 경기가 끝나기를 기다린다. 해당 시간 동안 다른 Worker 배포·설정 변경 및 Pages 배포를 동결한다. 활성 DO는 코드 전환 시 재시작·재접속할 수 있다. [C0 운영 체크리스트](./C4-1-WORKER-DEPLOY-READINESS.md) · [DO 수명주기](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
2. **실행.** 운영자 승인 후에만 `WORKER_PRODUCTION_DEPLOY_ENABLED=true`를 적용한다. [Worker Actions](https://github.com/oyueo-mm/YachtLab/actions/workflows/deploy-online-worker.yml)에서 **Run workflow → main**을 선택한다. `free_plan_confirmed`, 검토한 전체 `reviewed_sha`, 공개 `pages_build`, 100%의 `active_worker_version`을 입력한다. 시크릿 없는 verify 성공 뒤 **Review deployments**에서 운영자가 승인한다. 새 실행은 main tip·Pages·기존 100% 버전을 쓰기 직전 대조한다. Wrangler는 기존 Worker에 `--keep-vars --strict`를 사용한다. 예상 밖 바인딩·설정 충돌, 트래픽 분할, 활성 버전 변경 또는 유료 리소스 요구가 있으면 멈춘다.
3. **성공 판정.** Actions Summary의 SHA, 배포 ID와 새 Worker UUID를 Cloudflare의 100% 활성 배포와 대조한다. 공개 헬스·경제·로그인 설정, 승인된 테스트 계정의 전적·지갑·원장·인벤토리 보존, `catalogRev: 2`, 기존 보드 강화의 단일 차감, 신규 상품 판매, 1인 기록 동기화, 기존 방 재연결과 중복 정산 여부를 확인한다. 호출 이벤트 중단과 고정 오류 코드·운영 집계 유지, 외부 전송 상태를 확인한다. 작업 창을 닫을 때 승인된 범위에서 배포 활성화 변수를 다시 비활성으로 돌린다. [호환성 및 성공 기준](./C4-1-WORKER-DEPLOY-READINESS.md)
4. **실패와 롤백.** 쓰기 이후 CLI 실패나 타임아웃을 받으면 Workflow 재실행부터 하지 않는다. 대시보드에서 현재 트래픽, 배포 ID와 SHA 표시를 확인한다. 로그인·재접속·기존 데이터 읽기 불능, 대량 5xx, 원장 불일치·중복 차감이 있으면 새 쓰기를 중지하고 승인권자에게 알린다. 승인된 운영자만 **Deployments → 선택한 직전 호환 버전 → Rollback**을 사용한다. 코드 복귀 뒤 트래픽 100%, 버전 UUID와 새 배포 ID, 로그인·방 재접속·원장·로그 상태를 확인한다. 실행 권한과 실제 운영 데이터 보존은 이 관측까지 미검증이다. [Cloudflare 롤백 절차](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

### 남은 위험과 승인 필요 범위

- 구 Worker 복귀는 코드 설정을 되돌릴 수 있다. 이미 발생한 Rev.2 구매·강화 행이 스토리지에 남더라도 구 코드에서 미표시되거나 장착값이 바뀔 수 있고, 1인 계정 API가 다시 중단될 수 있다. 이전 버전의 자동 호출 로그도 다시 켜질 수 있으므로 복귀 후 즉시 확인한다. 데이터 복원, 삭제, 거래 취소는 별도 승인과 영향 검토 대상이다.
- 마스킹된 인증 표본은 다른 경로나 외부 로그 전송의 인증 데이터 및 OAuth 쿼리 수집 여부를 확정하지 못한다. 실제 노출이 확인되면 수집 경로를 확인하고 영향 범위를 좁혀 세션 회전 판단을 한다. 전체 세션 만료는 별도 명시 승인 대상이다. [SEC-01 사고 대응](./C4-1-WORKER-DEPLOY-READINESS.md#실제-노출이-확인된-경우)
- 2026-11-28 KST 저장소 읽기 조회에서 GitHub Environment는 `github-pages`만 있었고 `main` 보호 표시와 적용 규칙은 없었다. #123의 코드와 GitHub·Cloudflare 운영 설정은 적용 대기 상태다. Context sync 전환과 보호 규칙의 실제 동작, 시크릿 범위, 운영 계정의 결제·전송 상태, 롤백 권한·보존 검증을 닫은 뒤 릴리스 승인을 요청한다. [GitHub Environments](https://github.com/oyueo-mm/YachtLab/settings/environments) · [GitHub Rules](https://github.com/oyueo-mm/YachtLab/rules)
