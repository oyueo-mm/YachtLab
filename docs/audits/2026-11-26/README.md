# Online Yacht 독립 출시 감사

2026-11-26 KST. 기준은 26일 확인한 [main de312e8](https://github.com/oyueo-mm/YachtLab/commit/de312e8ec069e2c98b70cf1292a8c18510ba301c), 운영 정적 버전 [187b387](https://github.com/oyueo-mm/YachtLab/commit/187b387e51c00673ddd769672119105956fc3853), 병행 [Claude 성장 문서 dfd1ba1](https://github.com/oyueo-mm/YachtLab/blob/dfd1ba1/docs/context/GROWTH-2026-11-26.md)이다. [프로젝트 진입 문서](../../../CONTEXT.md), [제품 현황](../../../docs/context/ONLINE-YACHT-PRODUCT.md)

## 판정

격리된 2인 대전의 초대·완주·리뷰·재대결과 게스트 빠른 대전이 통과했다. 4인 동시 진행은 브라우저, 20인 순차·동시 진행은 로컬 Worker의 실제 WebSocket으로 완주했다. 저성능 초기 화면과 가로 점수판, 20인 브라우저, 실제 Google 콜백·설치 및 운영 한도 확인은 공개 확대 전 우선순위다. 무료 플랜의 입장 병목은 이 시나리오에서는 Cloudflare 계산 한도보다 애플리케이션의 동시 방 50개에서 먼저 올 수 있다. 20명 규모의 시간 집중 리허설부터 검토한다.

| 결과물 | 읽을 내용 |
|---|---|
| [QA 및 버그](00-qa.md) | 실제 사용자 경로, 브라우저·뷰포트, 증거, P0~P3 |
| [보안 검토](01-security.md) | 방어 계약과 출시 전 확인, 민감 정보 없는 내용 |
| [경쟁 서비스](02-competition.md) | 한국어 웹, 해외 웹과 모바일, 차별화 |
| [SEO·성능](03-seo-performance.md) | 검색, 원문 HTML, Lighthouse, 전송 비용 |
| [무료 수용량](04-capacity.md) | 10~5,000 CCU, 앱 한도·쿼터·비용 |
| [경제 밸런스](05-economy.md) | 실코드와 30일 모형, 가격·확률·유지 |
| [출시·홍보 실행](06-launch.md) | 콜드 스타트, 일정, 게시글 초안, 영상 |
| [연구 인프라](07-research.md) | 샤드·체크포인트·캐시·격리 |
| [후속 개발 백로그](08-backlog.md) | 공개 확대 전 기준과 담당 영역 |

## 재현

저장소 루트에서 `npm ci` 후, 첫 터미널 `npm run dev`, 둘째 `npm run online:worker`로 격리 서비스를 시작한다. `node docs/audits/2026-11-26/browser-qa.mjs`는 캐시와 로그인 이력이 없는 브라우저를 쓴다. `--multiplayer`는 로컬 Worker에서만 대전한다. `node --import tsx docs/audits/2026-11-26/20-seat-qa.ts`는 그 Worker에서 20인 순차 경기를 한 번 완주한다. `--simultaneous`는 동시 모드로 같은 검사를 한다. `--keyboard`는 뷰포트 축소, `--slow`는 4173 포트의 빌드 미리보기에서 감속 진입을 검증한다. 시스템 Chromium 경로가 다르면 `PW_CHROMIUM_PATH`를 지정한다. Firefox/WebKit은 Playwright 지원 시스템 라이브러리와 다운로드된 브라우저, Edge는 선택적으로 `PW_EDGE_PATH`가 필요하다. `YACHT_QA_PROFILE`로 이름에 해당하는 프로필만 실행하고 `YACHT_QA_EVIDENCE`로 저장 위치를 지정한다.

`npm run build` 후 `node docs/audits/2026-11-26/pwa-update.mjs`로 로컬 PWA 캐시 수명주기를 검증한다. `node docs/audits/2026-11-26/capacity.mjs`는 운영 요청 없이 가정값 표를 만든다. 경제는 기존 `npx tsx scripts/economy/simulate-live-draw.ts`로 재현한다. Lighthouse 원본 JSON을 `performance-summary.mjs`에 전달하면 지표·리소스·접근성 문제만 추출한다.

제품 파일·기본 모델·운영 배포 변경과 실제 홍보 게시·서비스 등록은 수행하지 않았다. 이 브랜치에는 보고서와 검증 스크립트 및 선별 증거만 들어 있다.
