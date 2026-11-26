# SEO·성능 독립 측정

2026-11-26 KST. 운영 Pages 빌드 `187b387-mwwtqjga`, 기준 브랜치 `de312e8`. 운영은 공개 읽기·일반 탐색 범위. Claude 작업 브랜치의 정적 확장과 기존 검색 등록 작업은 재구현하지 않았다.

## 운영 Lighthouse와 PSI

Lighthouse CLI 13.6.0, Chromium 156, Linux CPU 2코어 쿼터와 소프트웨어 렌더링이 있는 headless, 냉간 탐색 각 1회. 모바일은 기본 simulated 4배 CPU 감속, 150ms RTT·약 1.64Mbps 설정. 데스크톱은 데스크톱 preset이다. 도구 실행기 HTTPS 프록시 인증서 문제로 이 브라우저 실행에 한해 인증서 오류 무시 플래그를 사용했다. 다른 로컬 브라우저 작업과 자원 경합이 있었다. 같은 운영 사이트의 실사용자 p75나 반복표본의 대표값으로 볼 수 없다. [측정 데이터](evidence/lighthouse.json)

| 지표 | 모바일 | 데스크톱 |
|---|---:|---:|
| 성능 / 접근성 / 권장사항 / SEO | 44 / 95 / 100 / 100 | 40 / 95 / 100 / 100 |
| FCP | 1.73s | 0.82s |
| LCP | 4.72s | 3.17s |
| CLS | 0.034 | 0.084 |
| TBT | 18,749ms | 8,613ms |
| 요청 / 전송량 | 10 / 400,786 B | 10 / 400,783 B |

LCP 권장 2.5초, CLS 0.1, INP 200ms는 사용자 p75에서 적용한다. 위 TBT는 첫 진입 중 메인 스레드 블로킹 지표다. 첫 굴림·킵·점수 선택 INP의 대리 수치로 읽을 수 없다. PSI API 모바일·데스크톱 모두 429 쿼터 제한, PSI 화면은 이 URL을 처리할 수 없다고 표시했다. 따라서 PSI score, CrUX LCP/CLS/INP는 미확인이다. [PSI 방법과 필드 데이터](https://developers.google.com/speed/docs/insights/v5/about), [Web Vitals](https://web.dev/articles/vitals)

### 자산·비용

- Lighthouse 요청에서 엔트리 JS 200,940B 전송 / 625,998B 디코딩, 글로벌 CSS 39,355B / 192,543B, 3D stage 147,966B / 562,943B, table 5,736B 전송(모바일). 첫 방문 튜토리얼이 3D를 당겨온다. Precision DP 표는 이 집계의 네트워크 목록에 없었다.
- 로컬 main 빌드의 SW 설치 목록은 shell 포함 23개 파일, 압축 가정 약 1.93MB, 배포 파일 크기 합계 약 3.27MB다. DP gzip 1,324,626B, 제품 워커 약 69.67KB, 리뷰 워커 47.69KB. Lighthouse 일반 요청 총량과 SW 설치 트래픽은 측정 경계가 다르다. 실제 Pages 전송 캐시 정책의 중복 절감은 여기서 계측되지 않았다. [캐시 대상 생성](../../../vite.config.ts), [SW 등록](../../../src/main.tsx)
- 모바일 Lighthouse의 미사용 JS 진단은 약 176KiB 절감 가능성을 추정했다. 사용자 동작으로 쓰이는 코드가 포함될 수 있어 이 수치를 삭제량으로 간주하지 않는다. 3D stage 요청을 첫 굴림 이후로 넘기면 현재 응답 크기 기준 약 148kB가 초기 요청 집합에서 이동한다. LCP·TBT 개선량은 아직 실측이 없다.
- 후속 성능 비교는 최초 진입 3회 중앙값, 같은 기기·프록시·빌드, SW 활성 전후로 맞춘다. 저성능 기기에서는 2.5D 우선/3D 준비 지연, 표시 전 셸 공간 예약, 3D 초기화 시간을 비교한다. AI 선택·복기는 WASM 초기화·RSS·전략 응답 시간을 따로 기록한다.
- 접근성 95점은 상호작용 전체 검사 결과가 아니다. 공통 3D 킵 영역 `div`의 허용되지 않는 `aria-label`을 양쪽 Lighthouse에서 확인했다. 롤 버튼·킵·모달은 TalkBack/VoiceOver로 추가 검증한다. [코드](../../../src/PhysicalDice.tsx#L527), [QA](00-qa.md)

## 크롤링과 기술 SEO

| 항목 | 관측 | 다음 검증 |
|---|---|---|
| 홈 / 규칙 | 둘 다 HTTP 200, JS 없이 제목·설명·H1·링크. 홈 app shell에 작은 정적 소개, 가이드에 실제 규칙·전략 내용. | 가이드에 검색 intent별 실제 내부 링크를 넣은 Claude 브랜치가 배포되면 HTML 스냅샷 비교. [홈](https://oyueo-mm.github.io/YachtLab/), [규칙](https://oyueo-mm.github.io/YachtLab/guide/) |
| canonical / OG | 홈 절대 자기 canonical, guide 별도 canonical, OG 공유 이미지 메타. | 정적 6개 문서 경로/슬래시·canonical·사이트맵을 1:1로 비교한다. [Google canonical](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) |
| 사이트맵 / robots | 운영 사이트맵은 홈·가이드 2개. 호스트 루트 robots.txt HTTP 404는 비차단으로 취급된다. GitHub Pages 프로젝트 경로 아래 robots는 호스트 루트 정책을 대신하지 않는다. | 소유 확인이 가능한 검색 콘솔에서 사이트맵의 수집·색인 확인. 뷰/노출은 별도 데이터. [사이트맵](https://oyueo-mm.github.io/YachtLab/sitemap.xml), [robots 정책](https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt) |
| 구조화 데이터 | 홈 원문에서 WebSite와 VideoGame JSON-LD, 언어 ko, 무료 여부 확인. | 스키마 검증 도구에서 오류 확인. 검색의 리치 결과 자격은 별도. |
| 내부 링크와 URL | 해시 경로로 UI를 이동하며 가이드는 실제 경로와 앵커. 검색 랜딩은 별도 정적 경로가 적합하다. | 중복 의도 URL 확산 억제. 정적 텍스트와 실제 게임 링크를 연동. [Google JS SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics) |

## 검색 엔진 관측과 검색 의도

네이버 비로그인 데스크톱 HTML에서 ‘요트다이스’의 웹 카드에 YachtDice.cloud 홈페이지와 ‘규칙/전략 가이드’가 있었다. 앞부분에는 실물 보드게임·영상 Clip도 섞였다. 결과는 시간·지역·기기에 따라 변한다. 같은 질의의 Google 직접 HTML은 JS 진행 안내로 유효 결과를 얻지 못했다. Bing 직접 HTML은 무관한 ‘Query’ 결과라 순위 증거에서 제외했다. 웹 검색 서비스로 전 검색어군을 조사한 결과를 아래 후보와 비교했다. Google/Bing 실제 순위, 검색량, 사용자의 검색 콘솔 색인은 미확인이다.

| 검색어 | 의도 및 후보 | 제목·설명 비교 |
|---|---|---|
| 요트다이스, 야추, 야찌 | 규칙·실물/웹 혼합. YachtDice.cloud·PartyAt·PLAYORA·앱스토어. | YachtDice.cloud는 별칭과 무료, PartyAt은 폰 한 대 오프라인을 처음부터 말한다. |
| 요트다이스 온라인, 온라인 요트다이스, 야추 온라인 | 설치 없는 플레이, 친구 초대, AI/실시간. Turnpan·YachtDice.cloud·Funsoft. | Turnpan은 가입 없이 무료, Funsoft는 컴퓨터·친구. Online Yacht 운영 제목은 브랜드 일치, 설명은 무료와 12칸을 안내하지만 게스트 친구 링크는 제목·설명에서 두드러지지 않는다. |
| 요트다이스 무료, 야추 무료 | 진입 과금과 가입 여부, 즉시 대국. PLAYORA·Turnpan·Funsoft. | 업체들은 무료와 관련 모드를 제목에 함께 넣는다. 현재 브랜드 제목에서는 설명의 지원이 필요하다. |
| 요트다이스 모바일, 야추 모바일 | 브라우저/PWA, Android/iPhone 앱 대안. Yachu·럭키 다이스·Yahtz!. | 앱 이름·설명은 3D, 흔들기, 친구 대결을 말한다. 웹의 핵심은 설치 없이 먼저 플레이하는 경험이다. |
| 요트다이스 AI, 요트다이스 인공지능, 야추 AI | 봇 대결, 강함, 전략 분석. PLAYORA·YachtDice.cloud, 직접 검색에서 Nexon 월드 결과도 관측. | 시점에 따라 AI 검색 결과의 의도가 섞인다. AI 모드 이름·공정한 성능 근거와 복기 예시를 따로 제공한다. |
| Yacht Dice, Yahtzee | 규칙·전통/상표·여러 앱과 웹 및 Steam. Yahtzee.now·BGA·CardGames.io·Scopely. | Yahtzee.now는 무료 즉시 플레이, BGA는 브라우저/플랫폼을 강조. 영어 페이지를 내면 Nintendo식 12행과 13칸 게임 차이를 명확히 표시한다. |

네이버의 예시 제목은 ‘요트다이스 온라인 - 야추/야찌 무료 주사위 게임’이며 스니펫은 무료 웹 플레이, 친구 실시간, AI, 카카오·Google을 한 문단으로 표시했다. Turnpan의 타이틀은 ‘요트 다이스 온라인 무료 플레이, 가입 없이 바로’다. PLAYORA는 ‘AI 대전·혼자 하기·함께 하기’를 타이틀로 바로 나열한다. 실제 노출이 확인된 항목은 네이버의 단일 표본이다. [YachtDice.cloud](https://yachtdice.cloud/), [Turnpan](https://turnpan.com/ko/yacht), [PLAYORA](https://playora.lol/yacht/), [경쟁 분석](02-competition.md)

### 출시용 우선순위

1. Claude가 준비한 도움말군을 배포할 때 HTML-only 링크·canonical·sitemap·실제 200·404 상태와 접근성을 검증한다. 검색 콘솔의 소유 확인 상태는 계정에서 확인한다. [네이버 사이트맵](https://searchadvisor.naver.com/guide/request-feed)
2. LCP·첫 굴림이 주요 비용이다. 초기 3D와 SW 설치 및 AI 로드를 분리해 전송량과 CPU를 지표로 잡는다. 개선량은 동일 조건의 전후 결과로 기록한다.
3. 스팸성 링크 교환 대신 룰 비교/확률 표와 재현 가능한 복기 자료를 동아리 회고·게임 개발자 글·허용된 플랫폼 설명에 연결한다. 브랜드 이름보다 칭호처럼 보이는 홍보 문구를 붙이기 전에 실제 CTR·검색 노출을 확인한다.
