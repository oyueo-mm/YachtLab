# 온라인 요트다이스 제품 업데이트

## 브랜드와 탐색

서비스 표기는 온라인 요트다이스(Online Yacht)다. 돛의 세 점은 주사위의 눈을, 아래 실루엣은 배와 물 위 항적을 나타낸다. 기존 흰색 화면에서 어두운 바탕과 붉은 돛으로 구분한다. 로고는 SVG로 제공하고 브라우저용 파비콘, PWA 이미지와 공유용 1200×630 JPEG를 포함한다.

상단은 로고, 상점, 인벤토리, 회원 재화, 설정, 프로필을 제공한다. 작은 화면은 메뉴를 아이콘으로 표시하고 큰 잔액을 축약한다. 메뉴는 온라인 대전·오프라인 대전·친구·내 기록·퀘스트다. 설정의 효과음 스위치와 음량 조절기를 쓰며 연습은 오프라인 대전에서 연다. 최초 방문 기록, IndexedDB, 계정 키, PWA ID, 시작 URL, 범위, 서비스 워커 캐시 접두사 및 업데이트 절차는 기존 값을 사용한다. 진행 중 경기를 벗어날 때 기존 확인을 거친다.

기본 매우 어려움은 v4-D이며 v5-R은 시험 경로다. 연구 코드는 별도 연구 브랜치에서 진행한다.

## 검색 운영

- 공개 문서는 홈과 [규칙과 전략](https://oyueo-mm.github.io/YachtLab/guide/)이다. 두 페이지의 정적 HTML, 절대 canonical, 공유 메타, 내부 링크와 [사이트맵](https://oyueo-mm.github.io/YachtLab/sitemap.xml)을 제공한다. 게임의 해시 경로는 기존 북마크·방 초대·관전 링크에 사용하며 페이지별 브라우저 제목을 설정한다.
- GitHub Pages 프로젝트는 `/YachtLab/`만 배포한다. 검색 로봇 정책의 위치는 호스트 루트의 `/robots.txt`이고 확인 시 404였다. 프로젝트 경로에는 효력이 없는 robots.txt를 만들지 않는다. 존재하지 않는 경로의 404 HTML에는 noindex를 넣었다. [robots.txt 위치](https://developers.google.com/crawling/docs/robots-txt/create-robots-txt)
- Google Search Console은 `https://oyueo-mm.github.io/YachtLab/` URL 접두사 속성으로 추가한다. HTML 태그 인증을 선택해 제공된 메타 태그를 홈 HTML에 넣고 배포한 다음 소유 확인을 누른다. 사이트맵을 제출하고 URL 검사에서 홈과 도움말을 각각 확인한다. [소유 확인](https://support.google.com/webmasters/answer/9008080)
- Bing Webmaster Tools는 확인된 Google 속성을 가져오는 절차를 사용할 수 있다. 가져온 사이트맵을 확인한다. [Bing 가져오기](https://www.bing.com/webmasters/help/add-and-verify-site-12184f8b)
- 네이버는 사이트 등록 및 소유 확인에서 호스트를 요구할 수 있다. 프로젝트 경로를 거부하거나 호스트 루트 인증만 제공하면 현재 Pages 프로젝트에서 소유 확인을 마칠 수 없다. 계정이 프로젝트 등록을 허용하면 제공된 메타 태그 방식으로 확인하고 사이트맵을 제출한다. [네이버 등록·소유 확인](https://searchadvisor.naver.com/guide/faq-start-register)
- HTTP 응답과 자바스크립트 없이 읽히는 콘텐츠가 제공되는지 확인한다. 실제 색인, 검색 노출, 클릭수는 각 도구의 속성 리포트에서 확인한다. 소유 확인 토큰과 콘솔 정보는 이 저장소에 제공되지 않았다.

## 점수와 첫 굴림 확률

공정한 5개 주사위의 순서 있는 `6^5 = 7,776`개 결과를 `src/engine.ts`의 `score`로 검산했다. 포커 156, 풀 하우스 300, 스몰 스트레이트 1,200, 라지 스트레이트 240, 요트 6이다. 검색용 도움말은 각 족보를 독립적으로 세며 확률이 겹친다는 점을 설명한다.
