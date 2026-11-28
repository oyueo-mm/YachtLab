# C4 출처·확인일 (2026-11-28 감사)

> 모든 외부 출처의 확인일은 **2026-11-27 (KST)**. "열람" 열: **직접** = 원문 페이지를 열어 대조, **발췌** = 검색 엔진이 돌려준 공식 URL·요약만 확인(원문 미열람), **2차** = 언론·로펌·해설 자료.
> 조사 세션의 네트워크 정책으로 law.go.kr·pipc.go.kr·grac.or.kr·ftc.go.kr·korea.kr·docs.github.com·cloudflare.com(약관)·developers.google.com·support.google.com 원문 열람에 실패했다. **법령 조문·시행일은 원문 재확인 전까지 확정 근거로 쓰지 않는다**(아래 §재확인 목록).

## 저장소 내부 근거 (main `0462030`, 열린 PR 헤드)

| 키 | 위치 |
|---|---|
| REPO-WORKER | `worker/src/{index,accounts-api,account,oidc,economy,friends,friends-api,hub,host,config}.ts`, `worker/wrangler.toml` |
| REPO-CLIENT | `src/identity/{account-client,nickname}.ts`, `src/online/room.ts`, `src/social/catalog.ts`, `src/economy/live/draw.ts`, `src/shell/DrawPanel.tsx`, `src/analytics/attribution.ts`, `index.html` |
| REPO-CI | `.github/workflows/{deploy,deploy-online-worker}.yml`, `scripts/ci/classify-changes.mjs` |
| REPO-DOCS | `docs/economy/LIVE-ECONOMY.md`, `docs/online/SOCIAL-AND-ACCOUNTS.md`, `docs/operations/HOTFIX-ITEM-UPGRADE-2026-11-27.md`, `docs/audio/LICENSES.md`, `docs/context/ONLINE-YACHT-PRODUCT.md` |
| PR | [#112](https://github.com/oyueo-mm/YachtLab/pull/112) `1c25163`, [#113](https://github.com/oyueo-mm/YachtLab/pull/113) `e41439a`, [#117](https://github.com/oyueo-mm/YachtLab/pull/117) `c5d4d95`, [#118](https://github.com/oyueo-mm/YachtLab/pull/118) `c3d6f2b` |
| REPRO | 격리 재현 스크립트(Node 22, node:sqlite 메모리, 운영 무접촉) — 2026-11-27 실행으로 SEC-03·SEC-04 재현. **비공개 전달**(D-098), 저장소 미포함 |
| AUDIT-NPM | `npm audit` / `npm audit --omit=dev` 2026-11-27: 296개(운영 12) 패키지, 취약점 0 |

## Cloudflare (직접 열람 — 한도·요금·위치·로그)

| 키 | 내용 | URL | 열람 |
|---|---|---|---|
| CF-LIMITS | Workers Free 요청 100,000/일, CPU 10 ms, Error 1027 | https://developers.cloudflare.com/workers/platform/limits/ | 직접 |
| CF-DO-PRICE | DO Free 요청 100k/일, 13,000 GB-s/일, SQLite 행 읽기 5M·쓰기 100k/일, 저장 5 GB, Free=SQLite만 | https://developers.cloudflare.com/durable-objects/platform/pricing/ | 직접 |
| CF-DO-LIMITS | 객체당 저장 한도 표기 불일치(10 GB / FAQ 1 GB) | https://developers.cloudflare.com/durable-objects/platform/limits/ | 직접 |
| CF-DO-LOC | 생성 위치, `locationHint`, 관할 eu·us·fedramp만 | https://developers.cloudflare.com/durable-objects/reference/data-location/ | 직접 |
| CF-LOGS-1 | Workers Logs: 보존 Free 3일/Paid 7일, 20만 이벤트/일, `head_sampling_rate`, 호출 로그(요청·응답 메타데이터), `invocation_logs = false`, 2026-12-01 요금 체계 변경 | https://developers.cloudflare.com/workers/observability/logs/workers-logs/ | 직접(조사 에이전트) + 발췌 |
| CF-LOGS-2 | 콘솔 로그·예외·요청 메타데이터·헤더 자동 수집(변경 기록) | https://developers.cloudflare.com/changelog/2025-04-09-qb-workers-logs-ga | 발췌 |
| CF-LOGS-3 | Workers Trace Events 필드 | https://developers.cloudflare.com/logs/reference/log-fields/account/workers_trace_events/ | 발췌 |
| CF-PITR | SQLite DO 30일 시점 복구 API | https://developers.cloudflare.com/durable-objects/api/sql-storage/ (검색 결과 경로, 정확한 문서 경로 재확인 필요) | 발췌 |
| CF-TOS | Self-Serve Subscription Agreement(최종 갱신 2025-09-12 표기) | https://www.cloudflare.com/terms/ | 발췌 |
| CF-DPA | Customer DPA(Self-Serve 포함, v6.3 2025-06-20 / v6.4 2026-04-03 표기) | https://www.cloudflare.com/cloudflare-customer-dpa/ | 발췌 |

## GitHub (발췌)

| 키 | 내용 | URL |
|---|---|---|
| GH-PAGES | Pages 한도(1 GB, 월 100 GB 소프트), 상업 거래·SaaS 목적 무료 호스팅 금지 | https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits |
| GH-AUP | 광고 조항(주된 목적이 광고 금지, Pages 포함) | https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies |

## Google (발췌)

| 키 | URL |
|---|---|
| G-UDP | https://developers.google.com/terms/api-services-user-data-policy |
| G-VERIFY | https://support.google.com/cloud/answer/13464321 |
| G-BRAND | https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification |
| G-SENS | https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |
| G-BRANDING | https://support.google.com/cloud/answer/15549049 |
| G-ADSENSE | https://support.google.com/publisherpolicies/answer/48182 , https://support.google.com/adsense/answer/9336650 |

## 게임산업법·등급분류·확률형 아이템 (발췌·2차)

| 키 | 내용 | URL | 열람 |
|---|---|---|---|
| GAME-EXEMPT-1 | 비영리 게임물 등급분류 면제(2019) 문체부 보도자료 | https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=17434 , https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=17140 | 발췌 |
| GAME-EXEMPT-2 | GRAC 답변 보도(결제·광고·후원 = 영리) | https://www.inven.co.kr/webzine/news/?news=227071&site=indie , https://www.gamemeca.com/view.php?gid=1579331 | 2차 |
| GAME-21 | 제21조 조문(2차) | https://casenote.kr/법령/게임산업진흥에_관한_법률/제21조 | 2차 |
| GAME-PROB-1 | 확률 정보 공개 시행·해설서(2024) | https://www.korea.kr/news/policyNewsView.do?newsId=148927317 , https://www.korea.kr/news/policyNewsView.do?newsId=148922651 | 발췌 |
| GAME-PROB-2 | 유·무료 구분 해설 | https://www.hwawoo.com/newsletter/2024_02_20/240220_k_g.pdf , https://zdnet.co.kr/view/?no=20240222164405 , https://www.techm.kr/news/articleView.html?idxno=120476 , http://www.lawtimes.co.kr/news/articleView.html?idxno=196099 | 2차 |
| GAME-PROB-3 | 미표시 손해배상(최대 3배) | https://www.ceoscoredaily.com/page/view/2025080415181654698 , https://news.tf.co.kr/read/economy/2168158.htm , https://www.ddaily.co.kr/page/view/2025010614495495712 | 2차 |
| GAME-EXCH | 환전 금지·사행성 | https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=10410 , https://www.scourt.go.kr/sjudge/1627345946102_093226.pdf | 발췌 |
| GAME-REP | 국내대리인(2025-10-23 시행) | https://www.ddaily.co.kr/page/view/2025101417144080303 , https://www.bkl.co.kr/law/insight/newsletter/6274 | 2차 |
| GAME-2026 | 2026-10-01 국회 통과 개정(불만 처리 의무) | https://www.lawtimes.co.kr/news/articleView.html?idxno=228326 , https://www.bkl.co.kr/law/insight/newsletter/6788 | 2차 |
| GAME-REG | 제25조 등록(영문 법령) | https://elaw.klri.re.kr/kor_service/lawViewTitle.do?hseq=69946 | 발췌 |

## 개인정보 보호법 (발췌·2차)

| 키 | 내용 | URL |
|---|---|---|
| PIPA-SCOPE | 처리자 범위 판례 | https://www.scourt.go.kr/sjudge/1776736872554_110112.pdf , https://m.boannews.com/html/detail.html?idx=129300 |
| PIPA-GUIDE | 처리방침 작성지침 2025·2026 개정 보도 | https://mobile.newsis.com/view/NISX20260424_0003604909 , https://byline.network/2026/04/24-580/ , https://www.daeryunlaw.com/newsletter/news/151 |
| PIPA-EVAL | 처리방침 평가제 | https://m.boannews.com/html/detail.html?idx=125000 , https://www.shinkim.com/kor/media/newsletter/2484 |
| PIPA-VALID | 유효기간제 폐지(2023-09-15) | https://m.boannews.com/html/detail.html?idx=124350 |
| PIPA-XFER | 국외 이전 안내(PIPC) | https://pipc.go.kr/np/default/page.do?mCode=D060040000 |
| PIPA-CHILD | 제22조의2 | https://korea.legal/wiki/개인정보-보호법-제22조의2/ |
| PIPA-SAFE | 안전성 확보조치 기준 고시 | https://www.law.go.kr/LSW/ppcInfoP.do?ppcSeq=7759 , https://m.boannews.com/html/detail.html?idx=133982 |
| PIPA-2026 | 2026-09-11 시행 개정(과징금·유출 통지·법정손해배상) | https://www.lawtimes.co.kr/news/articleView.html?idxno=226414 , https://www.lawtimes.co.kr/news/articleView.html?idxno=226491 |

## 전자상거래·콘텐츠·통신·미성년자·접근성 (발췌·2차)

| 키 | URL |
|---|---|
| ECOM-REG | https://news.seoul.go.kr/economy/archives/95 , https://www.korea.kr/briefing/policyBriefingView.do?newsId=148733423 |
| ECOM-17 | https://korea.legal/wiki/전자상거래-등에서의-소비자보호에-관한-법률/ , https://www.law.go.kr/LSW/ftcInfoP.do?ftcSeq=489 |
| ECOM-DARK | https://www.lawtimes.co.kr/news/articleView.html?idxno=205545 , https://www.newsis.com/view/NISX20250213_0003063585 |
| CONTENT | https://www.mcst.go.kr/site/s_data/ordinance/instruction/instructionView.jsp?pSeq=886 |
| TELECOM-22 | https://ko.wikisource.org/wiki/전기통신사업법_시행령_(대한민국) |
| NET-44 | https://korea.legal/wiki/정보통신망-이용촉진-및-정보보호-등에-관한-법-7/ , https://www.lawtimes.co.kr/news/articleView.html?idxno=215607 |
| MINOR | https://www.lawtimes.co.kr/news/articleView.html?idxno=165694 , https://www.mcst.go.kr/site/s_notice/press/pressView.jsp?pSeq=17352 , https://zdnet.co.kr/view/?no=20210825102642 |
| A11Y | https://www.mcst.go.kr/kor/s_etc/webAccess/accessibility.jsp , https://www.scourt.go.kr/sjudge/1773799225853_110025.pdf |
| LICENSE | https://openfontlicense.org/ofl-faq/ , https://github.com/orioncactus/pretendard |

## 재확인 목록 (원문을 열 수 있는 환경에서)

1. 국가법령정보센터: 게임산업법·시행령(제2·21·25·26·28·31조의2·32·33·33조의2, 시행령 비영리 면제 조항·제18조의3·제19조의2·별표 3의2), 개인정보 보호법·시행령·안전성 확보조치 기준 고시, 전자상거래법 제12·13·17·21조의2와 통신판매업 신고 면제 고시, 전기통신사업법 제22조·시행령, 정보통신망법 제44조의2·44조의7·50조, 장애인차별금지법, 지능정보화기본법.
2. PIPC: 처리방침 작성지침 2025-04판·2026 개정판 PDF.
3. GRAC: 확률형 아이템 해설서·FAQ 최신본, 비영리 면제 안내, 등급분류 수수료·절차.
4. docs.github.com: Pages limits, AUP, Terms 원문.
5. cloudflare.com: Self-Serve Agreement, Service-Specific Terms, DPA 최신판, 하위처리자 목록. workers.dev에서 WAF·Rate Limiting Rules 적용 가능 여부.
6. Google: User Data Policy, OAuth 인증·브랜드 인증 요건, AdSense 정책. publicsuffix.org의 github.io·workers.dev 등재 여부.
