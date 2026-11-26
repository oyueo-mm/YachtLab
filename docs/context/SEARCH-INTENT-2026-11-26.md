# YachtLab 공개 검색 조사

**우선순위** · 홈은 ‘요트다이스 온라인’ 플레이, 친구 대전은 링크 초대, 규칙은 진행법, 점수판은 실물 주사위 채점으로 연결한다. 세 엔진의 기본어 자동완성에서 ‘온라인·점수판·족보’가 겹쳤다. 기존 8개 URL 안에서 이 역할을 드러내는 것이 첫 작업이다. [YachtLab 사이트맵](https://oyueo-mm.github.io/YachtLab/sitemap.xml)

## 조사 범위와 직접 응답

2026-11-26 14:24~14:29 UTC(23:24~23:29 KST). 비로그인 클라우드에서 데스크톱 첫 응답을 확인했다. Google은 `hl/gl=ko/kr, en/us`와 `pws=0`, Bing은 `mkt=ko-KR, en-US`, 네이버는 한국 통합검색에 두 언어의 질의를 그대로 입력했다. 언어·시장 파라미터로 지정한 표본이다. 한국·미국 실사용자 위치, 모바일 검색 화면, 개인화, 시점별 변동은 검증하지 않았다. Search Console 등 계정 보고서와 검색량 데이터에는 접근하지 못했습니다. 공개 표본으로 검색량·순위·색인 상태를 산정하지 않았습니다.

- **한국어 18개** · 요트다이스, 요트 다이스, 야추다이스, 야추 다이스, 요트다이스 온라인, 야추 다이스 무료, 요트다이스 PC, 요트다이스 모바일, 요트다이스 친구, 야추 다이스 멀티, 요트다이스 혼자, 요트다이스 AI, 요트다이스 룰, 요트 다이스 규칙, 요트다이스 점수판, 요트다이스 족보, 요트다이스 확률, 요트다이스 전략.
- **영어 10개** · Yacht Dice Online, Yahtzee Online, Yacht Dice Online free, Yahtzee Online multiplayer, Yacht Dice rules, Yacht Dice scorecard, Yacht Dice probability, Yahtzee optimal strategy, Yahtzee dynamic programming, Yacht Dice AI research.

| 엔진 | 공개 결과에서 관찰한 내용 | 자동완성 응답 예시 |
|---|---|---|
| Google | 28개 일반 검색 HTML이 모두 HTTP 200의 JS 안내를 반환했다. 대표 4개를 Chromium으로 열자 비정상 트래픽 화면으로 이동해 검색 결과는 읽을 수 없었다. [한국어 검색](https://www.google.com/search?hl=ko&gl=kr&pws=0&q=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4) · [영어 검색](https://www.google.com/search?hl=en&gl=us&pws=0&q=Yahtzee+Online) | ‘요트다이스 온라인·룰·점수판·족보’, ‘요트 다이스 pc’, ‘야추다이스 모바일·공략’, ‘야추 다이스 모바일 멀티’, ‘요트다이스 요트 확률’. 영어는 ‘yacht dice online multiplayer’와 ‘yahtzee online free / with friends / score card’. [한국어 JSON](https://suggestqueries.google.com/complete/search?client=firefox&hl=ko&gl=kr&q=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4) · [영어 JSON](https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=us&q=Yahtzee+Online) |
| 네이버 | 기본어에는 가격비교·클립·위키·게임이 함께 나왔다. ‘온라인’은 브라우저 게임과 앱, ‘PC’는 다운로드·에뮬레이터도, ‘모바일’은 앱 스토어도 함께 나왔다. ‘친구/멀티’에 Bloob·Foony, ‘혼자’에 PLAYORA·기글어스, ‘AI’에 yachtdice.cloud 연습, ‘점수판’에 인쇄/PDF·자동 채점 도구가 나타났다. ‘전략’에는 규칙·공략 가이드가 섞였다. 영어 ‘Yacht Dice Online’에는 Foony·Bloob과 한국어 게임 페이지, ‘Yahtzee Online’에는 CardGames.io·Bloob·CrazyGames가 나왔다. [기본어 결과](https://search.naver.com/search.naver?where=nexearch&query=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4) · [온라인 결과](https://search.naver.com/search.naver?where=nexearch&query=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4+%EC%98%A8%EB%9D%BC%EC%9D%B8) · [점수판 결과](https://search.naver.com/search.naver?where=nexearch&query=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4+%EC%A0%90%EC%88%98%ED%8C%90) · [영어 결과](https://search.naver.com/search.naver?where=nexearch&query=Yacht+Dice+Online) | 띄어쓰기 두 형태가 각각 붙여 쓴 ‘요트다이스’와 ‘야추다이스’ 후보군을 돌려줬다. ‘요트다이스 룰·점수판·온라인·족보·점수계산’, 점수판 뒤의 ‘사이트·앱·pdf’를 확인했다. 영어 10개는 후보가 비어 있었다. [기본어 JSON](https://ac.search.naver.com/nx/ac?q=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4&con=0&frm=nv&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100) |
| Bing | 한국어 표본에 무관한 주제 또는 일반 웹 결과가 검출되지 않은 HTML이 반복됐다. 영어 ‘Yacht Dice Online’은 선박 매물, ‘Yahtzee Online’은 CardGames.io·Solitaired·CrazyGames 등 플레이 페이지를 반환했다. [한국어 결과](https://www.bing.com/search?q=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4&setlang=ko&mkt=ko-KR) · [Yacht Dice 결과](https://www.bing.com/search?q=Yacht+Dice+Online&setlang=en&mkt=en-US) · [Yahtzee 결과](https://www.bing.com/search?q=Yahtzee+Online&setlang=en&mkt=en-US) | 기본어에서 ‘온라인·점수판·족보·pc·규칙’, 영어에서 ‘yahtzee online with friends / multiplayer / free no download’. 한국어 긴 질의 일부에 법령 등 무관한 후보가 섞여 관찰 근거에서 제외했다. [한국어 JSON](https://api.bing.com/osjson.aspx?market=ko-KR&query=%EC%9A%94%ED%8A%B8%EB%8B%A4%EC%9D%B4%EC%8A%A4) · [영어 JSON](https://api.bing.com/osjson.aspx?market=en-US&query=Yahtzee+Online) |

영어 연구 질의는 플레이와 다른 결과를 냈다. 네이버 ‘Yacht Dice probability’에는 AtCoder의 별도 주사위 문제, ‘Yahtzee optimal strategy / dynamic programming’에는 학술 자료와 솔버가 나왔다. ‘Yacht Dice AI research’에는 무관한 결과도 많았다. Google 자동완성에서 ‘yahtzee optimal strategy’와 ‘yahtzee dynamic programming’ 후보가 확인됐다. YachtLab 연구 콘텐츠는 12칸 규칙과 실험 목적을 제목·본문에서 명시할 근거가 있다. [네이버 연구 질의](https://search.naver.com/search.naver?where=nexearch&query=Yahtzee+dynamic+programming) · [AtCoder 해설](https://atcoder.jp/contests/abc421/editorial/13794) · [Verhoeff의 Yahtzee 연구](https://www-set.win.tue.nl/~wstomv/misc/yahtzee/yahtzee-report-unfinished.pdf) · [YachtLab 실험 결과](https://github.com/oyueo-mm/YachtLab/blob/main/docs/context/RESULTS.md)

**원본 응답** · 자동완성 84건 모두 HTTP 200 JSON을 읽었다. 위 JSON 링크에서 같은 요청을 재실행할 수 있다. 네이버·Bing 공개 검색은 HTML을 받았고 Google은 안내/차단 HTML만 받았다. 응답 본문 전체는 별도 파일로 저장하지 않았다. 빈 배열과 검색 결과 미검출은 이 표본의 상태다.

## 경쟁 페이지 6개

공개 HTML이 HTTP 200인 페이지를 골랐다. 제목·H1은 HTML에서 확인했고 설명은 meta description의 요지다. 기기·모드 지원은 페이지 문구를 비교했다. 실기기 플레이와 검색 리치 결과 표시는 검증하지 않았다.

| 페이지 | HTML 제목 / H1 | 설명, 규칙·기능·모바일 문구 | 주요 링크와 원본 HTML JSON-LD |
|---|---|---|---|
| yachtdice.cloud | 요트다이스 온라인 - 야추/야찌 무료 주사위 게임 / 홈 원본 H1 미검출 | 설명은 무료 실시간 멀티·AI 연습·카카오/Google 로그인. 가이드는 12칸, FAQ는 PC·폰·태블릿 무설치와 AI 비로그인, 온라인 대전 로그인 필요를 안내. | 홈 원본에 본문 앵커 미검출. 별도 가이드·FAQ·AI 연습 페이지 운영. `WebSite`, `WebApplication`, `SiteNavigationElement`. [홈](https://yachtdice.cloud/) · [가이드](https://yachtdice.cloud/guide) · [FAQ](https://yachtdice.cloud/faq) · [AI 연습](https://yachtdice.cloud/practice) |
| 야추 다이스 | 야추 다이스 온라인 - 무료 요트다이스·야찌 멀티 (PC·모바일) / 🎲 야추 다이스 | 설명은 3D 컵, 링크로 1~4명·관전·채팅, PC/모바일 무설치 무료. 12칸과 상단 63점 +35, 봇·한 기기 교대도 안내. | 홈 → 가이드 허브 → 룰·FAQ·점수 기준·실물용 점수판. `VideoGame`, `WebApplication`. [홈](https://yacht.100-0min.com/) · [가이드 허브](https://yacht.100-0min.com/board) · [실물 점수판](https://yacht.100-0min.com/score) |
| 기글어스 | 요트다이스 \| 온라인 주사위 게임·점수판 - 기글어스 / 요트다이스 | 설명은 5개·3회·12족보, 무료 솔로·AI·친구·점수판. 본문 친구 모드는 한 기기 2~4명 교대, 실물 점수판은 2~6명. 모바일 지원을 명시한 요트 본문 문구는 확인하지 못했다. | 같은 페이지에 FAQ·게임 모드, 게임 허브·관련 게임 링크. `VideoGame`, `WebApplication`, `FAQPage`, `BreadcrumbList` 등. [게임 페이지](https://www.giggleus.com/ko/game/yacht-dice) |
| moamoang | 요트 다이스(야추) — 온라인 주사위 게임, 규칙·점수표·확률 \| moamoang / 요트 다이스(야추) | 설명은 브라우저 12칸·점수 미리 보기·규칙 비교·확률. 솔로, 컴퓨터 1~3명, 한 기기 2~4명 지원을 안내. 폰은 점수 칸 두 번 터치. 기본 풀하우스에 같은 눈 5개를 허용하며 설정에서 3+2로 변경. | 본문에서 주사위 굴리기·범용 확률 도구·관련 게임 링크. `WebApplication`, `HowTo`, `FAQPage`, `BreadcrumbList`. [게임 페이지](https://moamoang.co.kr/yacht-dice/) |
| CardGames.io | Yahtzee \| Play it online / YAHTZEE | 설명은 무료·무설치·컴퓨터/사람 대전. 13칸 점수표와 추가 Yahtzee 규칙, 멀티 로비·비공개 테이블을 보여 준다. 휴대폰·태블릿용 앱 안내가 있다. | 같은 페이지에 규칙·전략, 별도 통계·아바타·다른 게임 모음 링크. `WebPage`, `ImageObject`. [게임 페이지](https://cardgames.io/yahtzee/) |
| Foony | Yahtzee Online Free: Play Yacht, the Original Dice Game \| Foony / Yacht Dice Game - Free Online Yahtzee-Style Dice Game with Friends | 설명은 무설치·무가입 무료, 친구 또는 컴퓨터 대전. 본문은 13칸 미국식 점수, 4단계 봇, 브라우저 초대 링크 및 PC·폰·태블릿을 안내. | 본문에 규칙·전략·FAQ, 별도 리더보드·업적·아이템·다른 게임 링크. `VideoGame`, `WebApplication`, `FAQPage`, `BreadcrumbList`, `AggregateRating` 등. [게임 페이지](https://foony.com/games/yacht) |

## YachtLab 페이지 매핑

공개 사이트맵의 8개 URL은 모두 HTTP 200과 자체 canonical을 반환했다. 아래 경로는 `/YachtLab/` 기준이다. 12칸, 상단 63점 +35, 풀하우스 3+2 주사위 합, 스몰/라지 15/30을 기준으로 쓴다. 미국식 Yahtzee 비교에는 13칸, 풀하우스 25, 스트레이트 30/40과 추가 Yahtzee 보너스 조건을 적는다. [YachtLab 규칙](https://oyueo-mm.github.io/YachtLab/guide/) · [YachtLab 비교표](https://oyueo-mm.github.io/YachtLab/faq/#compare) · [Hasbro 규칙 PDF](https://www.hasbro.com/common/instruct/yahtzee.pdf)

| 검색 의도 | 배정과 문구 방향 |
|---|---|
| 요트다이스·요트 다이스·야추다이스·야추 다이스 / 온라인·무료·PC·모바일 | **`/`**. 현재 H1 ‘온라인 요트다이스’를 중심으로 ‘야추 다이스’는 도입부에 자연스럽게 쓴다. ‘PC·모바일 브라우저에서 설치 없이 무료로 플레이’와 첫 화면의 대전 선택을 연결한다. 기기·PWA 질문은 **`/faq/#faq-6`**에서 답한다. [홈](https://oyueo-mm.github.io/YachtLab/) · [모바일 FAQ](https://oyueo-mm.github.io/YachtLab/faq/#faq-6) |
| 친구·멀티·2인 | **`/multiplayer/`**. 첫 문단에 게스트 초대 링크/6자리 코드, 2~20명, 순차·동시 진행을 명시하고 방 만들기로 연결한다. 한 기기 교대 플레이는 오프라인 대전으로 안내한다. 경쟁 페이지에서 ‘친구’가 두 방식을 모두 가리켰다. [YachtLab 친구 대전](https://oyueo-mm.github.io/YachtLab/multiplayer/) · [기글어스](https://www.giggleus.com/ko/game/yacht-dice) |
| AI·컴퓨터 대전 | **`/ai/`**. 5단계 상대와 경기 리뷰를 먼저 보여 준다. 한 차례 연습은 규칙 가이드에서 안내한다. 영문 연구 용어를 사용할 때는 ‘expected-score optimization’과 ‘head-to-head win probability’를 본문에서 정의하고 실험 기록에 연결한다. [AI 대전](https://oyueo-mm.github.io/YachtLab/ai/) · [실험 결과](https://github.com/oyueo-mm/YachtLab/blob/main/docs/context/RESULTS.md) |
| 룰·규칙·하는 법 / 족보·점수판·점수계산 | **`/guide/`**의 주 답변은 굴림→킵→기록 순서와 12칸 규칙. **`/scores/`**는 실물 주사위용 입력, 상단 보너스·합계·승자 자동 계산, 기기 저장, 족보 예시를 먼저 보여 준다. 두 문서의 관련 본문에서 서로 링크한다. [규칙 가이드](https://oyueo-mm.github.io/YachtLab/guide/) · [족보·점수판](https://oyueo-mm.github.io/YachtLab/scores/) · [경쟁 실물 점수판](https://yacht.100-0min.com/score) |
| 확률·킵 / 전략·공략 | **`/probability/`**는 첫 굴림, 남은 굴림, 킵 조건별 확률을 구분한다. **`/strategy/`**는 상단 보너스·킵·0점 처리의 선택 이유를 예로 보여 주고 계산기로 연결한다. [확률 계산기](https://oyueo-mm.github.io/YachtLab/probability/) · [전략](https://oyueo-mm.github.io/YachtLab/strategy/) · [경쟁 확률·규칙 비교](https://moamoang.co.kr/yacht-dice/) |
| Yacht Dice Online / Yahtzee Online / 영문 연구 | 영문 UI와 플레이 안내를 제공할 때 **`/en/` 후보**의 제목은 ‘Yacht Dice Online — Free 12-Category Browser Game’. Yahtzee 질의는 규칙 비교 문단에서 답한다. DP·확률·AI 연구는 **`/research/`** 및 **`/research/en/`**에서 다룬다. **`/ai/`**와 **`/guide/`** 본문에서 한국어 연구 페이지로 연결한다. 버전·시드·상대·신뢰구간과 기대점수/승리점수율을 명시한다. [Foony](https://foony.com/games/yacht) · [Hasbro](https://instructions.hasbro.com/en-us/instruction/yahtzee) · [YachtLab 실험 결과](https://github.com/oyueo-mm/YachtLab/blob/main/docs/context/RESULTS.md) |
| 혼자 하기·솔로 | **정식 출시 이후에만 `/solo/` 후보**. 상대 없이 12칸을 완주하는 모드가 공개되면 실제 제공되는 점수 도전·기록 기능을 설명하고 홈과 가이드에서 연결한다. 현재 ‘지금 플레이’ 링크는 실제 제공 중인 AI 대전·한 차례 연습의 이름으로 표시한다. [기글어스 솔로 사례](https://www.giggleus.com/ko/game/yacht-dice) · [YachtLab AI 대전](https://oyueo-mm.github.io/YachtLab/ai/) |

홈 → 모드·도구, 규칙 ↔ 점수판, 전략 → 확률 계산기, 각 안내 → 해당 플레이 화면의 일반 HTML 링크를 본문에 둔다. 현재 홈의 `WebSite`·`VideoGame`, 가이드의 `BreadcrumbList`·`HowTo`와 계산기의 `WebApplication`에 맞춰 화면에 실제 표시되는 정보로 메타데이터를 작성한다. [홈](https://oyueo-mm.github.io/YachtLab/) · [가이드](https://oyueo-mm.github.io/YachtLab/guide/) · [계산기](https://oyueo-mm.github.io/YachtLab/probability/)

Google은 HowTo 리치 결과를 2023년에, FAQ 리치 결과를 2026년 5월에 종료했습니다. FAQ와 진행 순서 마크업은 실제 페이지의 내용과 맞춰 유지합니다. 연구 문서에는 해당 언어를 표시한 TechArticle과 양방향 hreflang을 사용합니다. [Google Search 문서 갱신 이력](https://developers.google.com/search/updates) · [Google 변경 공지](https://developers.google.com/search/blog/2023/08/howto-faq-changes) · [hreflang 가이드](https://developers.google.com/search/docs/specialty/international/localized-versions)

## 로컬 배포 빌드의 성능 표본

새 Chromium 컨텍스트를 사용해 같은 머신에서 기존 안정화 빌드와 SEO 빌드를 각각 세 번 열었습니다. 로컬 서버, 서비스 워커 비활성, 데스크톱 1280×900 및 모바일 에뮬레이션 360×800 기준입니다. 모바일 기기 실측이나 필드 Core Web Vitals를 산정하지 않았습니다.

| 페이지 | 데스크톱 LCP 중앙값 | 모바일 LCP 중앙값 | 인코딩 응답 본문 합계 |
|---|---:|---:|---:|
| 안정화 빌드 홈 | 380 ms | 320 ms | 265,074 B |
| SEO 빌드 홈 | 368 ms | 344 ms | 265,057 B |
| 한국어 연구 | 264 ms | 200 ms | 18,077 B |
| 영어 연구 | 200 ms | 176 ms | 16,986 B |

연구 문서는 JavaScript 요청이 없었고 360px에서 문서 가로 스크롤이 없었습니다. 넓은 표는 내부에서 스크롤됩니다. 세 번의 로컬 표본에서 관찰한 LCP 차이로 운영 환경의 성능 변화를 판정하지 않습니다.
