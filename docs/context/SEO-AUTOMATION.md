# 검색엔진 등록·수집 자동화 (D-067, 2026-11-26)

수동으로 하던 사이트맵 갱신·수집 요청을 배포 파이프라인에 넣었다. 무료 인프라(GitHub Actions·Pages)만 사용한다.

## 흐름

1. **개발** — 검색 페이지를 바꾸면 `node scripts/seo/build-pages.mjs`를 실행한다. 페이지별 **콘텐츠 지문**(제목·설명·canonical·robots·JSON-LD·`<main>` 본문과 링크)이 바뀐 경우에만 `scripts/seo/lastmod.json`의 `lastmod`가 그날(KST)로 바뀌고 `public/sitemap.xml`이 다시 생성된다. 공통 메뉴·푸터·CSS·해시된 자산 이름은 지문에서 제외해 재빌드만으로는 lastmod가 움직이지 않는다.
2. **CI(`deploy.yml` build 잡)** — `build-pages.mjs --check`(사이트맵·lastmod가 최신인지), Pages용 빌드를 로컬 서버로 띄워 `verify-site.mjs`로 8개 URL의 HTTP 200·HTML 형식·자기 canonical·noindex(메타·`X-Robots-Tag`)·제목·설명·h1·JSON-LD·페이지 리소스와 IndexNow 키 파일을 검사한다. 실패하면 배포하지 않는다.
3. **배포** — 기존 구조 그대로. 추가로 `retain-assets.mjs`가 최근 배포의 해시 자산을 새 빌드에 보존한다(아래 리소스 조사).
4. **배포 후(`seo-indexnow.yml`)** — `Test and deploy YachtLab`가 main에서 성공하고 그 실행의 `deploy` 잡이 성공했을 때 실행된다. CDN이 이 커밋의 사이트맵을 내줄 때까지 최대 15분 기다린 뒤, 운영 사이트를 같은 기준으로 검증하고(추가로 Google 인증 메타, 루트의 네이버 인증 파일, 루트 robots.txt) 통과하면 IndexNow로 제출한다.
   - **엔드포인트**: Bing `https://www.bing.com/indexnow`, 네이버 `https://searchadvisor.naver.com/indexnow`. 각각 따로 상태를 둔다.
   - **변경 판정**: 엔드포인트별로 마지막으로 수락된 `url → { lastmod, fingerprint }`와 운영 사이트의 검증 결과를 비교한다. 같은 KST 날짜에 본문이 바뀌어도 지문 차이로 감지한다. 상태가 없으면 8개 전부, 이후에는 신규·변경·삭제 URL만 보낸다. 날짜만 기록된 기존 상태는 지문 기준선을 확보하기 위해 엔드포인트별로 한 번 재제출한다. 수락된 URL부터 상태를 갱신한다.
   - **재시도**: 네트워크 오류·408·425·429·5xx는 실행 안에서 5회(5→10→20→40 s, `Retry-After` 우선) 재시도. 그래도 실패한 엔드포인트는 상태를 올리지 않아 다음 배포·매일 10:41 KST 예약 실행·수동 실행 때 다시 보낸다. 400/403/422 같은 확정 오류는 즉시 실패로 기록한다.
   - **기록**: `seo-state` 브랜치의 `seo-state/state.json`(엔드포인트별 제출 상태), `log.jsonl`(모든 시도: 시각·커밋·실행 URL·응답 코드·시도 횟수·URL 목록), `last-verify.json`(마지막 검증 보고서). 실행 요약은 Actions Job Summary와 30일 보존 아티팩트에도 남는다.
   - **수동 실행**: Actions → SEO IndexNow → Run workflow. `mode=changed|all`, `dry_run`, `endpoints=bing,naver`.

## 키와 소유권 파일

- IndexNow 키 `b3678a0369af6c2c422e25516dad7aab`(공개 값, 비밀 아님). 호스트 루트 `https://oyueo-mm.github.io/<key>.txt`(oyueo-mm/oyueo-mm.github.io 저장소)와 프로젝트 `https://oyueo-mm.github.io/YachtLab/<key>.txt`(`public/`)에 둔다. 제출은 루트 위치를 `keyLocation`으로 쓰고, 루트 파일이 없으면 프로젝트 위치로 대체한다(하위 경로의 키는 그 경로 아래 URL에만 유효하며 현재 URL은 모두 `/YachtLab/` 아래). 설정: `scripts/seo/indexnow.json`.
- 보존: 홈의 `google-site-verification` 메타(단위 테스트·운영 검증), 루트 저장소의 `naver72ac84f1e67f72d17c210776019d4296.html`(운영 검증에서 내용까지 확인).
- 루트 저장소에 호스트 전체 `robots.txt`(`Allow: /`, `Sitemap: https://oyueo-mm.github.io/YachtLab/sitemap.xml`)를 추가했다. 그동안 호스트 루트 robots.txt가 404여서 사이트맵을 robots로 알릴 수 없었다(ONLINE-YACHT-PRODUCT의 이전 기록 참고).

## Google

일반 페이지에는 Indexing API(채용 공고·라이브 방송 전용)를 쓰지 않는다. 사이트맵 ping 엔드포인트도 2023년에 폐기됐다. Google은 Search Console에 등록된 `sitemap.xml`과 robots.txt의 `Sitemap:` 줄, 그리고 콘텐츠 기준 `lastmod`로 관리한다. 사이트맵 재제출 API(Search Console API)는 서비스 계정을 속성에 추가해야 해 이번 범위에서 제외했다.

## 공개 검색 콘텐츠

기존 8개 페이지에 한국어·영어 연구 문서 2개를 추가했다. 배포 검사와 IndexNow가 사이트맵의 10개 URL을 읽는다. 각 연구 판본은 자체 canonical, 양방향 `hreflang`, 해당 언어의 TechArticle 데이터와 본문 언어 전환 링크를 갖는다. [검색 의도와 경쟁 표본](./SEARCH-INTENT-2026-11-26.md) · [한국어 연구](https://oyueo-mm.github.io/YachtLab/research/) · [English research](https://oyueo-mm.github.io/YachtLab/research/en/)

## 페이지 리소스 3개 로딩 실패 조사

- 2026-11-26 운영 홈을 Googlebot 스마트폰 UA로 렌더링하면 하위 리소스는 4개(`assets/index-*.css`, `assets/index-*.js`, `icons/online-yacht.svg`, `version.json`)이며 모두 200·올바른 MIME이었다. 검색 페이지 7개도 `site/page.css`, 워드마크 SVG, `tools/yacht-odds.js` 모두 200. 호스트 robots.txt는 404(전부 허용)라 차단도 아니었다.
- 원인으로 확인된 구조: 빌드 ID가 번들에 들어가 **빌드마다 엔트리 JS 이름이 바뀌고**, Pages는 배포마다 사이트 전체를 교체한다. 실제로 직전 빌드의 `assets/index-DHq3sfe1.js`는 현재 404다. Google은 HTML 수집과 렌더링을 따로 하므로, 수집 뒤 하루 여러 번 있는 배포가 끼면 이전 HTML이 가리키는 CSS/JS가 404가 된다. Search Console의 실패 3개는 홈의 해시 자산(CSS·JS)과 함께 이런 시점 차이나, 공유 호스트 `github.io`에서 흔한 Google 측 가져오기 한도("기타 오류")로 설명된다. 특정 실패 시각과 URL은 Search Console 화면에서만 볼 수 있어 공개 응답으로 확정하지는 못했다.
- 조치: `retain-assets.mjs`가 운영 `asset-history.json`·`sw.js`·`index.html`을 읽어 최근 14일(최소 3세대, 최대 30세대) 배포의 해시 자산을 새 빌드에 복사한다(한 세대 약 4 MB, 대부분 이름이 같아 중복 없음). 실패해도 경고만 하고 배포를 막지 않는다. 열린 탭이 이전 빌드의 지연 로딩 청크를 요청할 때의 404도 함께 줄인다. 검색 콘텐츠는 원래 정적 HTML에 있어 렌더링 리소스 실패가 색인 본문에 미치는 영향은 작다.
- 확인 방법: 배포 후 Search Console URL 검사 → 실제 URL 테스트 → 페이지 리소스에서 실패 수를 다시 본다.

## 파일

| 파일 | 역할 |
|---|---|
| `scripts/seo/seo-lib.mjs` | 지문, 사이트맵, 메타 추출, 페이지 검사, 재시도 fetch, 변경 판정 |
| `scripts/seo/build-pages.mjs` | 검색 페이지·사이트맵·`lastmod.json` 생성/검사 |
| `scripts/seo/verify-site.mjs` | 로컬 빌드·운영 사이트 검증 |
| `scripts/seo/indexnow-submit.mjs` | 검증 후 엔드포인트별 제출, 상태·로그 |
| `scripts/seo/retain-assets.mjs` | 이전 배포 해시 자산 보존 |
| `.github/workflows/seo-indexnow.yml` | 배포 후·매일·수동 실행 |
| `tests/seo-automation.test.ts`, `tests/ui/seo.spec.ts` | 단위·브라우저 검증 |

## 남은 확인

- Bing Webmaster Tools → IndexNow 메뉴, 네이버 서치어드바이저 → 요청/수집 현황에서 실제 반영 확인(외부 콘솔, 로그인 필요).
- 네이버 사이트 등록이 호스트 루트(`https://oyueo-mm.github.io`)로 되어 있으면 사이트맵 제출란에 `https://oyueo-mm.github.io/YachtLab/sitemap.xml`을 한 번 등록한다(콘솔 작업).

## 최초 운영 실행 결과 (2026-11-26)

- 배포: `Test and deploy YachtLab` [run 45792606192](https://github.com/oyueo-mm/YachtLab/actions/runs/45792606192) (PR #100 병합 `4f2f24f`) 성공.
- 자동 제출: `SEO IndexNow` [run 45793761026](https://github.com/oyueo-mm/YachtLab/actions/runs/45793761026)(workflow_run). 운영 검증 오류·경고 0, 리소스 9개 200, 루트·프로젝트 키 모두 확인, keyLocation은 호스트 루트.
  - Bing: **202 Accepted**, 8개 URL, 1회 시도. 네이버: **200 OK**, 8개 URL, 1회 시도.
  - `seo-state` 브랜치 생성(`state.json`, `log.jsonl`, `last-verify.json`), 아티팩트 `indexnow-45793761026`.
- 배포 후 운영 검증(`verify-site.mjs`) 8/8 통과. 직전 배포의 엔트리 `assets/index-AMUgWoz-.js`가 새 배포 뒤에도 200으로 보존되고 `asset-history.json`에 2세대가 기록됐다.
- Bing 202는 "수신, 키 검증 대기"를 뜻한다. 실제 크롤링·색인 반영은 Bing Webmaster Tools·네이버 서치어드바이저에서 확인한다.
