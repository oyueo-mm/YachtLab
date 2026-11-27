# C4.1 운영 보안 및 Worker 배포 준비

2026-11-28 KST · 검토 기준 `main` `31dbc508b6dc37549589e9a643e4999eb98ae2dd` · 배포 판단 **보류**

## 확인 결과

| 항목 | 근거 및 상태 |
| --- | --- |
| 기존 C0 검증 | #112에 기록된 격리 Worker 교체·롤백, 계정·재화 데이터 보존 결과를 사용한다. 구 Worker에서는 1인 기록이 기기에 남고 신규 상품 11종은 판매 준비 중으로 표시된다. [C0 PR #112](https://github.com/oyueo-mm/YachtLab/pull/112) |
| 보드 강화 | #119는 구 Worker에서 기존 보드 11종의 새 단계가 `MAX_LEVEL`로 거절되는 경우를 재현했다. Hotfix는 Pages에서 지원 판을 확인한다. Rev.2 격리 검증에서 강화·단일 차감·원장·재시도·실패 시 원복을 확인했다. [Hotfix PR #119](https://github.com/oyueo-mm/YachtLab/pull/119) · [검증 기록](./HOTFIX-ITEM-UPGRADE-2026-11-27.md) |
| 마지막 성공 Worker Actions | 소스 `54c13679f04e11c13efd2d0e7d3a7b412d86167b`, 당시 버전 `900728c2-c252-4dc7-be9f-0b698826eca7`. 운영자가 2026-11-28 KST에 Cloudflare에서 확인한 인증 GET의 실행 UUID와 일치한다. 현재 트래픽 비율·배포 ID 및 롤백 가능 여부는 Deployments에서 확인해야 한다. [Actions 실행](https://github.com/oyueo-mm/YachtLab/actions/runs/45772443229) |
| 운영 공개 GET | Pages `version.json`은 `db2e17a-mwz88q0x`. Worker `/healthz`는 `ok: true`, `/api/features`는 `signIn: true`, `economy: true`, `/api/auth/config`는 `google: true`. 공개 응답에는 현재 Worker UUID나 인증된 카탈로그 판이 없다. `db2e17a`와 검토 기준 main의 차이는 자동 생성 문서 2개다. [Pages 빌드 ID](https://oyueo-mm.github.io/YachtLab/version.json) |
| GitHub 통제 | 공개 저장소다. 읽기 조회에서 Environment는 `github-pages`만 확인됐고 `main`의 보호 표시와 활성 브랜치 규칙은 없었다. 저장소 시크릿 목록은 권한 부족으로 확인하지 못했다. [Environments](https://github.com/oyueo-mm/YachtLab/settings/environments) · [브랜치 규칙](https://github.com/oyueo-mm/YachtLab/rules) |
| 감사 범위 | SEC-01/B-03은 IP·위치 메타데이터 수집 **확인**, 인증 토큰 원문 노출 **미확인**으로 갱신한다. SEC-07/B-13은 Worker 배포 통제, SEC-16/B-32는 워크플로 변경 시 전체 CI다. [C4 감사 PR #121](https://github.com/oyueo-mm/YachtLab/pull/121) |

## Workers Logs — SEC-01 / B-03

| 항목 | Cloudflare 공식 문서 및 적용 |
| --- | --- |
| 자동 이벤트 | 호출마다 요청·응답 관련 메타데이터가 담긴 `cf-worker-event`가 생성된다. Fetch 메시지는 메서드와 URL을 포함한다. 커스텀 콘솔 로그, 오류 및 처리되지 않은 예외도 수집 대상이다. Workers Logs, 실시간 로그, Logpush, Tail Workers, OTLP 내보내기를 각각 확인한다. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [실시간 로그](https://developers.cloudflare.com/workers/observability/logs/real-time-logs/) |
| 인증 헤더 및 IP | 아래 운영 관측을 참조한다. Workers Logs 문서에서 `Authorization`, `Cookie`, `Set-Cookie` 및 IP 전달 헤더의 필드별 수집·마스킹 보장을 확인할 수 없었다. `CF-Connecting-IP`는 Cloudflare가 제공하는 요청 헤더다. 애플리케이션이 속도 제한에 IP 해시를 사용해도 Cloudflare의 요청 메타데이터에는 별도 기준이 적용된다. 다른 경로, 버전 및 내보내기에는 별도의 확인이 필요하다. [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) · [Cloudflare HTTP 헤더](https://developers.cloudflare.com/fundamentals/reference/http-headers/) |
| URL과 쿼리 | Fetch 호출 로그는 URL을 쓸 수 있다. 이 서비스의 OAuth 콜백 쿼리에 코드·상태가 있으며 OAuth 응답의 리디렉션 헤더와 쿠키도 민감하다. Wrangler의 `observability.redact_query_string`은 로그·트레이스의 요청 URL 쿼리 제거 설정이다. 수동 콘솔 출력이나 별도 내보내기에서의 헤더·경로·응답 마스킹은 따로 확인한다. [Wrangler 설정](https://developers.cloudflare.com/workers/wrangler/configuration/) · [Cloudflare Workers API](https://developers.cloudflare.com/api/resources/workers/) |
| 보존·비용 | 2026-11-28 확인 기준 Workers Free는 하루 200,000개 이벤트·3일 보존, Paid는 기본 월 20,000,000개·7일 보존이다. Cloudflare는 2026-12-01부터 Free의 Observability 공용 수집 한도를 하루 0.5 GB, 보존을 7일로 전환한다고 공지했다. 배포일에 Billing 및 로그 보존 표시를 재확인한다. 내보낸 사본은 대상 저장소의 별도 보존·권한 정책을 따른다. [Workers Logs 한도 및 요금](https://developers.cloudflare.com/workers/observability/logs/workers-logs/#limits) · [12월 Observability 요금](https://developers.cloudflare.com/observability/pricing/) · [Workers Trace Events 데이터셋](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/) |

[Wrangler 변경안](../../worker/wrangler.toml)은 호출 로그와 트레이스를 끄고 쿼리 마스킹을 켠다. 애플리케이션 진단에는 고정 OIDC 오류 코드와 `ONLINE_WORKER_UNEXPECTED`만 기록한다. 집계 기반 Workers 지표 및 기존 운영 집계 경로를 유지한다. 최상위 오류 처리기는 임의 예외 메시지를 로그에 넘기지 않는다. 플랫폼 자동 오류·예외 및 별도 내보내기가 제공하는 메타데이터는 적용 후 점검한다.

### 운영 관측 — SEC-01 갱신

2026-11-28 KST 운영자가 확인한 인증 GET 표본에서는 `Authorization`이 마스킹됐다. `CF-Connecting-IP`와 `X-Real-IP`는 원문 수집이 확인됐다. IP 기반 도시·지역·위도·경도·우편번호·통신사, `User-Agent`, 요청 URL도 수집됐다. 이 관측 기록에는 필드 이름과 판정만 남긴다. 다른 경로의 인증 데이터나 OAuth 쿼리 원문 수집은 미확인이다.

실행 버전 UUID는 `900728c2-c252-4dc7-be9f-0b698826eca7`로 `54c1367`의 기존 Actions 기록과 일치한다. 대상 계정의 **Workers Free** 플랜을 확인했다. 사용자 전체 세션 강제 만료와 운영 Worker 배포는 보류 상태다.

### OAuth 콜백의 쿼리 위험

`/auth/google/callback`은 쿼리의 `code`·`state`를 읽는다. Cloudflare가 기록하는 요청 URL에 쿼리가 포함될 경우 이 값들이 호출 로그에 들어갈 수 있다. 확인된 요청의 `Authorization` 마스킹으로는 OAuth URL이나 응답 헤더의 마스킹 여부를 판단할 수 없다. 호출 로그 중단과 쿼리 제거를 함께 적용하고, 이후에는 격리된 합성 표식이나 운영 집계 필드로 확인한다. 실제 OAuth 코드를 사용한 로그 검증은 피한다. [Worker OAuth 경로](../../worker/src/accounts-api.ts) · [Cloudflare Workers API](https://developers.cloudflare.com/api/resources/workers/)

### 운영자 점검

1. Cloudflare의 대상 계정 → **Workers & Pages → yachtlab-online → Settings / Observability**에서 활성 버전 기준 Logs, Invocation logs, 샘플링, 트레이스·Issues, 쿼리 제거, Logpush·Tail Workers·OTLP 목적지와 접근 권한을 확인한다. Analytics/Observability에서 플랜별 보존과 이벤트 수를 대조한다.
2. 보존 기간 안에서 조회 권한을 가진 운영자가 이벤트 유형과 시각으로 범위를 좁혀 필드 목록·집계 필터를 확인한다. 요청·응답 양쪽의 인증·쿠키 헤더, `CF-Connecting-IP`·`X-Forwarded-For` 등 IP 필드, 요청 URL과 쿼리, 리디렉션 헤더, 자동 예외 및 각 내보내기 대상에서 **없음 / 마스킹 / 원문 가능 / 미확인** 중 하나로 기록한다. 기존 고객 이벤트 원문을 열거나 내보내지 않는다. 로그 JSON, 스크린샷, 값, IP, 방 코드, URL 전체를 남기지 않는다.
3. 마스킹을 가를 근거가 부족하면 가능한 경우 승인된 격리 환경에서 인증 효력이 없는 합성 헤더·쿼리 표식만 사용하고, 집계 필터로 일치 여부를 확인한다. 실제 OAuth, 고객 세션 및 고객 IP를 실험 데이터로 사용하지 않는다. 운영에서 안전하게 판별할 수 없는 필드는 미확인으로 남긴다.
4. 승인된 배포 후 정상 요청의 호출 이벤트가 신규로 쌓이지 않는지 확인한다. 기존 오류가 자연 발생하면 고정 진단 코드와 자동 오류 메타데이터의 수집 범위를 확인한다. 기록에는 버전 UUID, 점검 시각, 필드별 판정, 내보내기 유무, 후속 담당자만 남긴다. 민감 필드가 계속 보이면 운영자가 관련 수집·외부 전송 중단을 별도로 승인하고 적용한다. 이전 로그의 보존 기간은 새 설정과 별도로 확인한다.

### 실제 노출이 확인된 경우

- 사고 담당자가 최초·최종 수집 시각, 필드 유형, 영향 세션 범위, 읽기·내보내기 접근자와 외부 목적지를 파악한다. 원문 재수집 없이 집계와 접근 감사 증거를 제한된 경로에 보존한다. 노출 경로부터 차단하고 외부 사본의 보존·삭제와 해당 시 통지 여부를 검토한다.
- 대상이 특정되면 해당 세션을 폐기하고 재로그인한다. 계정 단위 확산은 해당 사용자에 대한 `logout-all`을 검토한다. 계정 세션은 DO에 토큰 해시로 저장되므로 `AUTH_SECRET` 교체만으로 기존 로그인 세션이 폐기되지는 않는다. Google OAuth 시크릿·관리자 토큰 등은 각 자격 자체의 노출 여부를 확인해 별도로 회전한다. [세션 저장](../../worker/src/account.ts) · [로그아웃 경로](../../worker/src/accounts-api.ts)
- 피해 범위를 좁힐 수 없고 전체 무효화가 필요하면 사고 담당자가 영향, 사용자 공지, 재로그인 및 확인 절차를 정리해 소유자의 명시적 승인을 받는다. 승인 전 전체 세션 초기화는 보류한다. 회전 후 기존 세션 거부, 새 로그인 동작, 추가 수집 중단 및 이상 계정 작업을 확인한다.

## GitHub 배포 통제 — SEC-07 / SEC-16 / B-13 / B-32

1. **운영자가 승인 후 적용할 설정.** GitHub **Settings → Environments**에서 `worker-production`을 수동 생성한다. 배포 브랜치는 Selected branches and tags의 **Branch `main`** 한 개로 제한한다. Required reviewers에 실제 승인자를 두고 관리자 보호 규칙 우회를 끈다. 별도 승인자가 있으면 Prevent self-review를 켠다. 저장소가 공개여서 현재 GitHub Free에서도 요구 검토자 기능을 지원한다. 단독 운영으로 분리가 어려우면 워크플로와 별개의 명시적 승인 기록을 남기고 적용 가능한 승인 설정을 사용한다. [GitHub Environments 설정](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
2. **시크릿 전환과 기존 경로 폐쇄.** 운영용 `WORKER_PRODUCTION_API_TOKEN`, `WORKER_PRODUCTION_ACCOUNT_ID`는 이 Environment에만 등록한다. 필요한 Cloudflare 계정과 가능한 최소 Worker 쓰기 범위를 사용한다. 과거 브랜치의 워크플로에서 접근할 수 있는 저장소·조직 범위의 기존 배포 토큰을 제거하거나 다른 의존성을 확인한 후 폐기·교체한다. 앱 런타임 시크릿은 제자리에 둔다. GitHub 이외의 배포 키·자동 빌드·대시보드 경로를 확인하고 승인된 비상 경로만 운영한다. 보호 규칙과 시크릿 전환을 점검한 뒤에만 Environment 변수 `WORKER_PRODUCTION_DEPLOY_ENABLED=true`를 설정한다.
3. **main 보호.** PR 및 승인, Actions의 안정적인 필수 체크 `ci-result`, 최신 base 기준 검사, 강제 푸시·삭제 금지와 우회 제한을 적용한다. 다른 검토자가 있다면 배포 워크플로와 `scripts/ci/`, Worker 설정 변경을 검토 대상에 둔다. 워크플로 파일 추가·수정·삭제·이동은 `full`로 분류해서 단위·빌드·Playwright를 수행한다. Pages 워크플로의 배포도 `main`으로 제한한다. 현재 Context sync는 생성 문서를 `main`에 직접 푸시한다. PR 필수 규칙 적용 전에 생성 문서 갱신을 PR 경유로 전환할 방법을 점검한다. [Context sync 워크플로](../../.github/workflows/context-sync.yml) [필수 상태 검사 설정](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
4. **워크플로 확인.** `main` 수동 실행에 Free 확인, 검토한 전체 SHA, 공개 Pages 빌드 ID, 현재 100% 활성 Worker UUID를 입력한다. 시크릿 없는 job이 단위·빌드·번들 dry-run을 먼저 수행한다. Environment 보호 규칙이 설정돼 있으면 deploy job은 승인을 기다린다. 승인 뒤 실행 직전 Cloudflare의 직전 100% 버전, 공개 Pages 빌드와 `main` tip을 비교한다. 검증된 커밋을 배포하고 Cloudflare 메시지와 Actions Summary에 Git SHA·실행 번호·직전/신규 버전 및 배포 ID·Pages 빌드를 기록한다. 이전 시도를 재실행할 경우에는 새 검토와 새 실행이 필요하다.
5. **동시성 및 승인 기능 대안.** Worker workflow는 단일 동시성 그룹을 사용하며 실행 중 배포를 취소하지 않는다. GitHub 동시성은 대시보드·CLI 배포나 Pages에 적용되지 않는다. 작업 시간 동안 운영자가 직접 배포·설정 변경과 Pages 배포를 동결한다. 필요한 보호 기능을 쓸 수 없으면 Actions에 운영 토큰을 두지 않고 배포 변수를 비활성으로 둔다. 운영자가 별도의 승인 기록, 성공한 CI, 검토한 `main` SHA를 확인한 뒤 제한된 운영자 환경에서 동일한 확인 절차로 배포한다. 수동 실행 체크박스만으로 승인 통제를 대체하지 않는다. [GitHub Actions 동시성](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency)

## C0 운영자 배포 체크리스트

### 승인 전

- [ ] **활성 버전과 롤백 권한.** Cloudflare **Workers & Pages → yachtlab-online → Deployments**에서 계정·서비스, 실제 트래픽 비율, 활성 버전 UUID와 배포 ID, 시각을 적는다. 인증 GET에서 관측한 실행 버전과 대조한다. 한 버전이 100%인지 확인한다. 그대로 재배포 가능한 직전 버전을 선택하고 권한을 확인한다. 과거 Actions 버전은 대시보드 관측과 맞을 때만 사용한다. Cloudflare가 허용하는 보존 범위·최근 100개 버전 및 DO 수명주기 변경 제한을 확인한다. 실제 데이터가 변경된 뒤에는 코드 롤백과 데이터 복구가 별개다. [Versions & deployments](https://developers.cloudflare.com/workers/versions-and-deployments/) · [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
- [ ] **기존 Durable Objects.** `ROOMS/YachtRoom`, `DIRECTORY/RoomDirectory`, `USERS/UserStore`, `GUESTS/GuestLink`, `HUB/MatchHub`, `FRIENDS/FriendIndex`의 이름·클래스·SQLite 네임스페이스 연결과 적용된 마지막 migration `v4`를 확인한다. 대조 기준인 `54c1367`부터 main까지 migration과 바인딩은 동일하다. C4.1은 이 정의를 그대로 쓴다. 누락·이름 변경·새 네임스페이스 또는 미적용 migration이 발견되면 승인 전에 원인을 확인한다. [Worker 설정](../../worker/wrangler.toml)
- [ ] **변수·시크릿.** 선언된 변수의 의미와 운영 일치 여부를 확인한다. CORS, OAuth 반환 주소, 경제/뽑기, 방/AI 한도, `SERVER_AI` 등 대시보드 전용 설정을 대조한다. `--keep-vars`는 대시보드 전용 일반 변수를 보존하며 Wrangler에 명시된 값에 우선권이 있다. `--strict`는 Wrangler가 감지한 일부 원격 설정 충돌에서 배포를 중단한다. `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET` 및 설정돼 있다면 `ADMIN_TOKEN`은 이름과 존재만 확인한다. 시크릿 값 조회·재입력·삭제 없이 기존 바인딩을 사용한다. [Wrangler deploy 옵션](https://developers.cloudflare.com/workers/wrangler/commands/workers/#deploy)
- [ ] **기존 데이터.** `54c1367` 대비 계정 DB 추가는 멱등 `CREATE TABLE IF NOT EXISTS solo_records`다. 기존 계정·세션·전적·지갑·원장·인벤토리 저장 구조와 DO 연결 변경은 발견되지 않았다. C0 격리 교체·롤백과 #119의 강화 검증을 재사용한다. 운영 네임스페이스 및 실제 사용자 데이터는 이 작업에서 검증하지 않았으므로 승인된 테스트 계정으로 배포 전의 읽기 기준을 확보한다. 기록에는 일치 여부와 계수만 남긴다.
- [ ] **Pages와 기능 계약.** 실제 `version.json`의 빌드를 소스 SHA에 연결한다. 현재 빌드는 #119 및 #117을 포함한다. 최신 Pages와 직전 배포 번들/PWA 탭에서 로그인, 방 생성·재접속, 전적, 기존 카탈로그·장착을 확인한다. 이전 Pages의 카탈로그 필터는 모르는 ID와 새 단계 표현을 제한할 수 있고 보유 데이터는 서버에 남는다. Hotfix 포함 Pages는 `catalogRev` 누락을 Rev.1로 처리하고 미지원 강화·판매를 막는다. 새 Worker에서는 인증된 경제 스냅샷 `catalogRev: 2`, 기존 보드 Lv.2/Lv.3·신규 11종 지원, `GET/POST /api/me/solo` 호환을 테스트 계정에서 확인한다. 캐시된 구 Pages에서 기능이 표시되지 않으면 새로고침 후 확인한다. 공개 기능 플래그는 인증 경로 검증을 대신할 수 없다.
- [ ] **온라인 방.** 한산한 작업 시간을 예약하고 Cloudflare 지표 및 운영자가 접근하는 집계(진행/대기/관전·접속 수)로 영향 범위를 본다. `liveRooms`는 등록된 방 수로 진행 중인 경기 수와 다를 수 있다. 활성 경기는 가능하면 완료될 때까지 기다린다. 기존 WebSocket을 닫거나 방·DO를 삭제하지 않고, 진행 중 HTTP/RPC와 소켓이 재연결될 수 있다고 간주한다. Cloudflare의 기본 DO 코드 업데이트 유예는 최대 5분이며 최선 노력 방식이다. 배포·롤백 뒤 기존 테스트 방 재접속, 좌석·턴·점수판, 한 번만 기록되는 정산을 확인한다. [Durable Object 수명주기](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/)
- [ ] **Free 플랜.** 운영자가 Workers Free를 확인했다. 배포 직전에 Billing/Subscriptions에서 같은 계정의 플랜, 유료 결제 비활성 및 Workers·SQLite DO·로그 여유를 재확인한다. 계정의 기존 Worker와 SQLite DO만 사용한다. 플랜 업그레이드 또는 D1/R2/KV/Queues/새 네임스페이스/유료 로그 대상 생성이 요구되면 보류한다. 플랜 증거 확인 후에만 `free_plan_confirmed`를 선택한다. [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/) · [DO 요금과 Free 한도](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [ ] **명시적 승인.** 운영 변경 승인자와 시각, 최종 main SHA, Pages 빌드, 직전 Worker UUID, 롤백 담당자와 중단 조건을 적는다. GitHub 통제 전환이 끝난 뒤 지정 시간에 수동 실행한다.

### 승인된 배포 직후

- Cloudflare 활성 배포 및 버전 UUID가 Actions Summary와 일치하는지 확인한다. 헬스·기능·Google 설정과 기존 Pages 동작을 확인한다. 지정 테스트 계정으로 기존 기록·지갑·원장·인벤토리 읽기, 기존 보드 강화와 단일 차감, 신규 상품 판매, 1인 기록 동기화, 장착 및 방 재연결을 확인한다. 테스트 쓰기는 별도 승인된 테스트 계정만 대상으로 한다. 실제 고객 기록을 조회하거나 원장·스냅샷 원문을 CI에 저장하지 않는다.
- Worker·DO 5xx, WebSocket 이탈 및 재접속, 로그인, 경제 오류, Free 사용량을 변경 전과 비교한다. DO 업데이트가 완료될 시간을 두고 재확인한다. Workers Logs와 내보내기는 위 점검 항목을 시행한다. 기록에는 배포 식별자와 결과만 남긴다.

### 실패 및 롤백

1. 사전 검증 실패는 배포 보류다. Wrangler가 원격 충돌을 보고하거나, 쓰기 시도 후 실패·타임아웃·상태 조회 오류가 나면 GitHub 결과만 보고 재시도하지 않는다. Cloudflare의 트래픽과 Git SHA/Actions 실행 메시지를 대조해 진행 여부를 판정한다. 영향을 평가하고 승인권자에게 알린다.
2. 로그인 불능, 대량 5xx·재접속 실패, 기존 계정·원장 읽기 오류, 중복 차감·부정합이 나타나면 후속 배포를 중지한다. 직전 버전이 새 데이터와 공존 가능한지 확인한 후, 승인된 운영자가 Cloudflare Deployments의 Rollback 또는 `npx wrangler rollback <확인한-UUID> --config worker/wrangler.toml`을 사용한다. 새 배포 ID·트래픽·복귀한 버전 기록과 기본 기능 확인을 반복한다.
3. Rev.2에서 이미 판매·강화가 발생했다면 이전 코드에서도 행과 원장은 남지만, 구버전이 새 상품이나 단계를 숨기거나 구버전 장착 재저장에서 해당 장착이 대체될 수 있다. 구 Worker 기간에 1인 계정 API도 중단된다. 이 경우 쓰기 영향 및 복구 호환성을 먼저 확인하고 승인된 수정 버전으로 복구하는 경로도 검토한다. SQLite 데이터 되감기, 네임스페이스 재생성, 거래 취소 또는 전체 세션 초기화는 별도의 사고 복구 판단과 승인 대상이다.
4. 과거 버전 롤백은 호출 로그 설정을 되돌릴 수 있다. 로그 수집·외부 전송 상태를 즉시 확인하고 실제 노출 우려가 있으면 사고 담당자에게 넘긴다. [Cloudflare 롤백 제한](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)

## 저장소 검증

- Node 24 빌드, 변경된 두 워크플로의 actionlint 검사, Wrangler 4.166.0 로컬 dry-run이 통과했다. dry-run은 기존 DO 바인딩 6개를 인식했다.
- 모의 릴리스 검증 8개가 통과했다. 정상 릴리스 식별자 기록, 버전 불일치·트래픽 분할·Pages 불일치·main 갱신 시 쓰기 전 중단, 배포 메시지 불일치·헬스 오류·Wrangler 실패 감지를 확인했다.
- CI 분류, 경제 Worker 및 온라인 Worker 관련 Vitest 24개가 통과했다.
- 관련 Playwright 브라우저 검증은 41개 통과, 기존 조건부 7개 건너뜀이었다. 상점과 강화 호환 처리, 1인 플레이, 격리 Worker의 회원 장착과 온라인 방 동작을 확인했다.
