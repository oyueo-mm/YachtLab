# C0 운영 상태 점검 및 Worker 배포 판단 — 2026-11-27 KST

## 결론

Worker 배포 보류. 마지막 성공 기록의 Worker 소스에는 1인 기록 계정 동기화와 카탈로그 2판이 없다. 해당 버전이 현재 활성 상태라면 `main`의 Worker 업데이트가 필요하다. 현재 활성 Cloudflare 버전, 계정의 Workers Free·유료 결제 비활성 상태, 운영 바인딩 및 롤백 권한은 확인 대기다. Pages는 마지막 성공 배포와 `main` 사이에 제품 코드 차이가 없어 재배포하지 않았다.

## GitHub 및 운영 근거

| 항목 | 2026-11-27 확인 결과 |
| --- | --- |
| 원격 `main` 및 테스트 대상 | `d8a24a8b72633b2ebc6ebce25dfbfd40f8be4cce` |
| 인수인계 브랜치 | `4e09675f8a00056df4fdf1363103b88b59a92fc6`. 양쪽 전용 커밋 수는 `0 / 1`. 추가 파일은 [차기 개발 인수인계](https://github.com/oyueo-mm/YachtLab/blob/handoff/next-development-20261127/docs/context/NEXT-DEVELOPMENT-2026-11-27.md) 한 개 |
| 열린 PR | GitHub 웹 응답의 `openCount` 0. [Pull requests](https://github.com/oyueo-mm/YachtLab/pulls) |
| 최신 `main` CI | `d8a24a8` 정기 전체 CI 성공, `deploy` skipped. 실행 이벤트는 `schedule`이며 워크플로의 배포 조건에서 제외된다. 인수인계의 Pages 성공 표기는 CI 성공 기록으로 정정한다. [Actions 45924348336](https://github.com/oyueo-mm/YachtLab/actions/runs/45924348336) |
| 마지막 Pages 배포 기록 | `9f6a80c88ab6be39ed9757ba15bec9f194cdc5a6`의 `deploy` 성공. 이후 차이는 `docs/context/_generated/`의 두 파일이다. 실제 Pages 응답의 빌드 ID 확인은 대기 중이다. [Actions 45859480166](https://github.com/oyueo-mm/YachtLab/actions/runs/45859480166) |
| 마지막 Worker 배포 기록 | 수동 워크플로 목록의 최신 실행이 성공. 소스는 `54c13679f04e11c13efd2d0e7d3a7b412d86167b`. Cloudflare 활성 버전 UUID와 이후 대시보드·CLI 변경 여부는 확인 대기다. [Actions 45772443229](https://github.com/oyueo-mm/YachtLab/actions/runs/45772443229) |
| 운영 접속 | Codex Cloud에서 Pages `/YachtLab/version.json` 및 Worker `/healthz`·`/api/auth/config`의 HTTPS CONNECT가 403으로 차단됐다. GitHub API와 Cloudflare API도 같은 제한을 받았으며, GitHub 웹과 HTTPS Git 조회는 성공했다. 이 작업에 연결된 Cloudflare 자격증명과 계정 연동은 확인되지 않았다. |

Pages 배포 직후의 별도 확인 기록은 2026-11-27 01:38 KST에 `9f6a80c`의 사이트맵과 공개 페이지 10개·리소스 10개를 검사해 오류 0건을 기록했다. 마지막으로 표시된 운영 온라인 테스트 성공은 Worker 배포 기록보다 앞섰다. 두 기록은 당시 운영 관측이다. [Pages 검증 데이터](https://github.com/oyueo-mm/YachtLab/blob/ca81ad7fbe75450e2abd258856f5a800af057fae/seo-state/last-verify.json) · [SEO 후속 실행](https://github.com/oyueo-mm/YachtLab/actions/runs/45860585419) · [이전 온라인 실서비스 확인](https://github.com/oyueo-mm/YachtLab/actions/runs/45567970811)

[현재 코드의 컨텍스트](../context/README.md), [기존 인수인계](../context/HANDOFF.md), [결정 기록](../context/DECISIONS.md), [로드맵](../context/ROADMAP.md), [자동 생성 스냅샷](../context/_generated/CURRENT_STATE.md), [Cloudflare 운영](../online/ONLINE-V01-PHASE4.md), [계정](../online/SOCIAL-AND-ACCOUNTS.md), [경제·원장](../economy/LIVE-ECONOMY.md), [컬렉션](../context/COLLECTIONS-2026-11-27.md)을 현행 소스 및 Actions와 대조했다.

## 운영 기능과 버전 호환성

| 기능 | 마지막 배포 기록의 소스 `54c1367` | `main` 및 확인 방법 |
| --- | --- | --- |
| 로그인 및 계정 | Google OIDC와 계정 API 구현. 운영 비밀 설정과 로그인 성공 여부는 미확인 | 인증 구성과 기존 API의 계약을 유지한다. 운영에서는 익명 `GET /api/auth/config`의 `google` 값으로 구성 상태를 보고, 지정된 테스트 계정으로 로그인·재접속을 검증해야 한다. |
| 1인 기록 계정 동기화 | 서명된 `GET/POST /api/me/solo` 404. 현재 Pages 클라이언트는 기기 기록을 유지하고 서버 미지원 상태를 표시 | 기존 계정 SQLite에 `solo_records` 테이블 추가. 기기 기록은 `client-reported`로만 보관하고 중복 레코드를 건너뛴다. 대전 전적·재화·업적과 분리된다. 운영 활성화는 미확인 |
| 신규 상품 11종 | `catalogRev` 필드가 없어 현재 Pages가 1판으로 처리한다. 신규 상품은 “판매 준비 중”을 표시하고 구 Worker의 API는 신규 ID를 거부 | 인증된 `GET /api/me/economy`의 `snapshot.catalogRev: 2`와 경제 활성화가 확인돼야 한다. 신규 11종은 상점 판매 경로에 들어가며 뽑기에서는 제외된다. 운영 활성화는 미확인 |
| 빠른 대전·친구·방·관전 | 해당 기능과 WebSocket 프로토콜 구현 | 방 엔진·전송 타입·OIDC 소스 및 Wrangler DO 설정의 기존 구성을 유지한다. 가입 여부와 세션에 따라 동작이 달라지며 실제 운영 흐름은 미확인 |

`54c1367`의 브라우저 번들을 따로 빌드한 뒤 Chromium에서 `main` Worker에 연결했다. 이전 번들이 기존 회원 세션으로 `/api/me/economy`의 `catalogRev: 2` 응답을 받아 회원 이름을 DOM에 반영하고 상점 탭을 표시했다. 이전 클라이언트의 기존 API에는 필수 새 필드가 없다. `catalogRev`는 선택 필드이고 1인 API는 추가 경로다. 기존 카탈로그 ID의 카테고리·등급·획득 방식·시즌·은퇴 속성과 코인·보석 가격, 기본·크리스마스 뽑기 풀의 등급별 상품 ID가 유지됨을 확인했다. 신규 주사위·보드 ID를 모르는 이전 렌더러는 기본 외형을 사용한다. 사용자에게 이전 클라이언트로 장착을 새로 저장하게 하면, 그 빌드가 이해하지 못하는 신규 장착을 대체할 수 있으므로 최신 Pages와 함께 확인할 항목이다.

운영 Worker가 기록대로 `54c1367`이라면 Pages와의 차이는 의도된 기능 대기 상태다. `/healthz`의 `ok`는 응답 가능 여부만 나타낸다. Worker 활성 버전은 Cloudflare Deployments와 대조하고, 상품 및 1인 기능은 인증된 응답으로 각각 확인해야 한다.

## 데이터 보존과 롤백

- `git diff 54c1367..d8a24a8 -- worker/wrangler.toml .github/workflows/deploy-online-worker.yml src/online` 결과 변경 없음. 대상 `yachtlab-online`, 기존 SQLite DO 여섯 클래스와 마이그레이션 태그 `v1`~`v4`가 같다. 계정 변경은 `CREATE TABLE IF NOT EXISTS solo_records` 추가이며 기존 계정·세션·전적·원장·인벤토리·장착 스키마의 제거 또는 변경이 없다.
- 실제 `wrangler dev --local`에서 한 임시 SQLite 저장소와 로컬 가짜 OIDC를 사용해 `54c1367 → d8a24a8 → 54c1367 → d8a24a8` 순으로 재시작했다. 기존 세션·프로필·가져온 전적·친구 관계·잔액·원장·보유·장착·슬롯의 동일성, 중복 구매 멱등성, 기존 방 좌석 토큰 재접속을 검증했다. 새 Worker에서는 신규 11개 상품 모두 유효한 판매 항목으로 잔액 검사까지 도달했다. 이 경로는 결제 거절로 끝났고 잔액은 동일했다. 1인 기록 중복 제출은 한 번만 저장됐고 대전 전적·잔액에 반영되지 않았다. 구 버전으로 돌아가면 1인 API가 404가 되고, 신 버전을 다시 적용하면 저장한 1인 기록이 복원됐다.
- 위 검증은 가짜 계정과 로컬 바인딩에 한정된다. 운영의 DO 네임스페이스 연결, 계정별 SQLite 데이터, 시크릿 이름의 존재 및 대시보드 변수는 소유자가 확인해야 한다. 워크플로가 읽는 GitHub 시크릿 `CLOUDFLARE_API_TOKEN`·`CLOUDFLARE_ACCOUNT_ID`는 존재와 대상 계정만 확인한다. 현재 워크플로에는 `--keep-vars`가 없다. Wrangler 4.166.0 도움말에 따르면 배포는 시크릿을 삭제하지 않으며, 일반 변수는 Wrangler 설정의 값으로 교체한다. 배포 전에 Cloudflare의 현재 변수와 [Wrangler 설정](../../worker/wrangler.toml)을 대조하고, 보존해야 할 대시보드 전용 값이나 차이가 있으면 그대로 실행하지 않는다.
- 배포 전에 활성 버전 UUID·배포 ID와 롤백 권한을 기록한다. 배포 직후 기존 고객 기능에 장애가 발생하면 Cloudflare Deployments에서 확인한 직전 호환 버전으로 복귀할 수 있다. 운영 상태를 지우거나 SQLite를 과거 시점으로 되돌리지 않는다. 새 상품 판매나 기존 보드의 신규 강화 단계 사용 뒤 구 코드로 복귀하면, 원장·소유권 행은 남아도 구 카탈로그에서 신규 항목이나 단계가 표시되지 않을 수 있다. 구 Worker에서 장착을 다시 저장하면 신규 아이템 장착값이 대체될 수 있다. 1인 계정 기록은 복귀 기간에 API 접근이 중단된다. 이 문제가 생기면 거래·재화 영향을 먼저 확인하고, 필요 시 두 기능을 이해하는 수정 버전으로 복구한다.

## 로컬 검증

Node.js 24.22.3, npm 11.19.1, 시스템 Chromium. `npm ci --cache .npm-cache --no-audit --no-fund`로 잠금 파일 기준 설치. Wrangler의 XDG 설정·캐시를 Git 제외 경로에 지정했다. 모든 브라우저 테스트는 로컬 Vite 미리보기와 로컬 서버 또는 테스트 응답을 사용했다.

| 명령 또는 검사 | 결과 |
| --- | --- |
| `npm ci --cache .npm-cache --no-audit --no-fund` | 200개 패키지 설치, 성공 |
| `npm run build` | 앱·서버·Worker 타입 검사 및 Vite 빌드 성공. 500 kB 초과 청크 경고 |
| `npm test -- --maxWorkers=1` | 최종 전체 실행 종료 코드 0. 64개 파일, 503개 테스트 통과. |
| `PW_CHROMIUM_PATH="$(command -v chromium)" npm run test:ui -- tests/ui/{solo,collections,economy,profile,onboarding-shop,online,online-entry,multi-online,quick-match,friends,match-rewards,pwa}.spec.ts --workers=2` | 관련 12개 스펙에서 95개 통과, 31개 건너뜀, 실패 0. 여러 기기 컨텍스트를 직접 만드는 테스트 등 저장소의 프로젝트별 조건을 따랐다. |
| `npm test -- tests/online-ai.test.ts tests/research-v6.test.ts --maxWorkers=1 --reporter=verbose` | 2개 파일, 9개 테스트 통과. 서버 AI 스레드 CPU p99 4.50 ms와 v6 비교 22.27초로 두 실패 항목을 재확인했다. |
| `node_modules/.bin/wrangler deploy --dry-run --config worker/wrangler.toml --outdir /tmp/yachtlab-c0/worker-dry-run` | 로컬 번들·바인딩 확인 성공. 347.99 KiB, gzip 88.16 KiB |
| `node_modules/.bin/tsx /tmp/yachtlab-c0/compat-browser.mts` | 격리된 workerd 교체 및 이전 Chromium 번들 검증 성공. 스크립트는 작업용 임시 파일이며 위 데이터 보존 절에 검사 범위를 기록했다. |

병렬 실행 결과에 편차가 있었다. 최초 2워커 실행은 Vitest 요약이 503개 통과였으나 빌드와 묶어 실행한 셸이 1로 종료돼 명령별 종료 코드를 재확인했다. 3워커 실행에서는 v6 비교가 60초 제한을 넘었고, 다음 2워커 실행에서는 서버 AI CPU p99가 12.00 ms로 저장소 기준인 8 ms 미만을 충족하지 못했다. 해당 서버 AI 소스와 테스트는 마지막 Worker 배포 커밋 이후 변경이 없다. 위 단독 검증에서는 두 항목이 통과했다. 테스트 코드와 판정 기준은 유지했다.

## 후속 검증

- v6 연구의 DP 테이블·PMF 일치 테스트는 병렬 실행에서 60초 제한을 초과했고, 단독 실행에서 22.27초로 통과했다. 다음 Worker 릴리스 검증에서 CI 러너의 병렬 조건으로 재현 여부와 소요 시간을 확인한다.
- 서버 AI 스레드 CPU p99는 병렬 실행에서 12.00 ms로 저장소 기준(8 ms 미만)을 초과했고, 단독 실행에서는 4.50 ms였다. 다음 Worker 릴리스 검증에서 기존 기준으로 재측정하고, 다시 초과하면 원인을 확인한 뒤 배포 여부를 판단한다.

## 운영 확인을 재개하는 조건

1. 현재 환경에서 `oyueo-mm.github.io`와 `yachtlab-online.hoho96385210.workers.dev`에 읽기 요청이 가능하도록 허용한다. Pages `version.json`, Worker `/healthz`와 `/api/auth/config`를 먼저 검증한다. Cloudflare Deployments의 활성 버전 UUID·배포 이력은 소유자의 읽기 확인 또는 권한 있는 읽기 전용 접근으로 대조한다.
2. 대상 계정이 **Workers Free이고 유료 결제가 비활성**임을 소유자가 현재 시점 기준으로 확인한다. 과거 운영 문서와 Actions 성공은 현재 플랜의 근거가 될 수 없다. 기존 DO 네임스페이스·변수·시크릿과 롤백 버전 및 권한을 확인한다. 자격증명 값은 공유하지 않는다.
3. 운영 Worker가 구버전으로 확인되고 테스트가 통과하면, 실행 직전 `main` SHA를 다시 확인하고 [기존 수동 Worker 워크플로](https://github.com/oyueo-mm/YachtLab/actions/workflows/deploy-online-worker.yml)를 사용한다. 워크플로의 `free_plan_confirmed` 입력은 계정 확인 후에만 설정한다. 이번 C0 작업에서 새 배포 실행은 만들지 않았다.
4. 배포를 실행하는 경우 Actions 결과와 실제 활성 버전 UUID를 기록한다. 지정된 격리 테스트 계정과 테스트 방으로 로그인·재연결·1인 기록 조회 및 동기화·카탈로그 2판·상점 표시·빠른 대전·친구 대전·관전을 확인한다. 계정 경제 조회가 신규 환영 보상을 일으킬 수 있으므로, 운영에서는 환영 처리가 완료된 지정 계정에서 조회하고 구매·정산 검증은 로컬로 한정한다. 이번 점검에서 운영 계정이나 실제 재화·데이터를 수정하지 않았다.

**C1과 A1 착수 판단.** C1은 경제 v2 연구·시뮬레이션으로, A1은 주사위 물리·보드 연출·성능 개발로 각각 분리해 병행 착수한다. 운영 상태에 의존하는 결론, 경제 정책·카탈로그 변경, 실제 배포는 각자의 확인과 승인 이후에 진행한다.
