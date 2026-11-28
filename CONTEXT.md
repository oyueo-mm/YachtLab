# YachtLab — 프로젝트 맥락 빠른 진입

> **새 채팅에서 이 파일부터 읽으세요.** 이 파일은 AI 연구·실험·개발의 공유 맥락 진입점이며, 실제 소스와 검증 결과를 함께 대조하기 위한 출발점입니다.

## 현재 프로젝트

- 코드: https://github.com/oyueo-mm/YachtLab
- 배포: https://oyueo-mm.github.io/YachtLab/
- 게임: Nintendo-style Yacht Dice, 12카테고리, 주사위 5개/최대 3회, 상단 63점 +35점. **미국식 13카테고리 Yahtzee와 다름.**
- 핵심 기준선: DP Expert의 전체 게임 기대점수 **191.760879752165점**.
- 확인된 승률 연구: Win DP v2 vs DP Expert **20,000경기 50.630%**(근사 95% CI 50.406~50.854%), vs Win DP v1 **10,000경기 50.435%** (CI 50.132~50.738%).
- 목표: 승리 점수율·일반화·계산시간 기준으로 다양한 AI를 경쟁시키되 SOTA는 검증 없이는 주장하지 않음.

## 맥락 읽는 순서

> **오늘의 요트·오늘의 전략 퍼즐·일일 랭킹(LIVE-1, 운영 비공개)** → [DAILY-LIVE-1](docs/context/DAILY-LIVE-1.md) (D-LIVE1-1~D-LIVE1-6).
>
> **온라인 요트다이스 제품 개편** → [브랜드, 메뉴, 검색 및 배포 인수인계](docs/context/ONLINE-YACHT-PRODUCT.md).
>
> **콘텐츠 확장(2026-11-27): 1인 플레이·개인 기록, 게임 프로필, 테마 컬렉션 10종·신규 11종·시너지, 기간 한정, 상점·뽑기 안내, 오디오 믹스, 모바일** → [COLLECTIONS-2026-11-27](docs/context/COLLECTIONS-2026-11-27.md), [연승 검토](docs/context/STREAK-REVIEW-2026-11-27.md), [오디오 믹스](docs/audio/MIX.md) (D-074~D-078). 워커 수동 배포 전에는 1인 기록 계정 보관·신규 상품 판매가 대기 상태.
>
> **게임 완성도·꾸미기 개편(주사위 30·보드 20·이모티콘 41 강화 연출, 설정 시트, 자체 작곡 BGM, 키보드 단축키, 규칙·FAQ 개편)** → [POLISH-2026-11-26](docs/context/POLISH-2026-11-26.md) (D-068~D-073).
>
> **검색엔진 등록·수집 자동화(IndexNow Bing·네이버, 콘텐츠 lastmod, 배포 후 검증)** → [SEO-AUTOMATION](docs/context/SEO-AUTOMATION.md) (D-067).
> **검색 콘텐츠 및 공개 AI 연구** → [검색어·경쟁 페이지 조사](docs/context/SEARCH-INTENT-2026-11-26.md), [한국어 연구 보고서](https://oyueo-mm.github.io/YachtLab/research/), [English research report](https://oyueo-mm.github.io/YachtLab/research/en/).
>
> **제품 개선·성장 기반(2026-11-26: CI 샤드, 게임판 중심 UI, 비회원 상점, SEO 페이지·계산기, 공유, UTM)** → [GROWTH-2026-11-26](docs/context/GROWTH-2026-11-26.md) (D-060~D-065, 완료/미완료 구분).

> **AI 승률 연구(Win DP v5, 정확 PMF·정확 2인 종반)** → [V5-APEX-RESEARCH](docs/context/V5-APEX-RESEARCH.md) (연구 브랜치, 기본 AI 불변, D-V5-1). 확증: v5-R vs Win DP v2 **50.626%**(100k, 99% CI 50.372–50.879), vs v3 50.479%, vs DP Expert 51.223%.
> **AI 승률 연구(Win DP v6, 정책군 롤아웃·전 구간 BR·WASM)** → [V6-APEX-RESEARCH](docs/context/V6-APEX-RESEARCH.md) (연구 브랜치, 기본 AI 불변, D-V6-1). **v6-P가 v5-R과의 직접 대결에서 50.131%(9511, 10만 경기)·50.209%(9512 재현)로 작지만 유의하게 우위**(공통 상대 v2 이득은 미확정). 실행 최적화: WASM PMF 생성기(TS와 비트 동일, 브라우저 워커 8.1 s), 로더 RSS 677→379 MB, Float32 결정 손실 0.
> **AI 승률 연구(Win DP v7, 상대 반응 정지가치)** → [V7-APEX-RESEARCH](docs/context/V7-APEX-RESEARCH.md) (연구 브랜치, 기본 AI 불변, D-V7-1). v7-I1RO vs v6-P: 9531 50.091%(Holm 미달)·재현 9541 50.136%(유의).
> **AI 연구 현황(2026-11-26): 잠정 종료** — 매우 어려움 v4-D 유지, v5-R·I2RO1 교체 보류(D-V7-6). 최종 후보 I2RO1은 v4-D 대비 확증(50.55%), v5-R과는 대국상 동등. → [V7-APEX-RESEARCH](docs/context/V7-APEX-RESEARCH.md) §9–11, [V7-PRODUCT-HANDOFF](docs/context/V7-PRODUCT-HANDOFF.md).
> **AI 제품 통합(v5-R·WASM 은행·분석 API v6)** → [V6-INTEGRATION-HANDOFF](docs/context/V6-INTEGRATION-HANDOFF.md).
>
> **재화·상점·퀘스트·업적을 다룬다면** [실서비스 경제](docs/economy/LIVE-ECONOMY.md)부터(M3i-W30 실제 구현·원장·가격표·퀘스트·업적, 결정 D-040~D-042). 연구 배경: [경제 연구 보고서](docs/economy/ECONOMY-RESEARCH.md)(D-029~D-037).
>
> **온라인 친구 다인전(2~20명, 동시 진행)** → [MULTIPLAYER](docs/online/MULTIPLAYER.md)(D-044).
>
> **빠른 대전·관전방·서버 AI 대전** → [MATCHMAKING](docs/online/MATCHMAKING.md)·[SERVER-AI-MATCH](docs/online/SERVER-AI-MATCH.md)(D-038·D-039).
>
> **게임·온라인·계정 기능을 개발한다면** 먼저 [제품 개발 현황](docs/context/PRODUCT-2026-11-24.md)을 읽으세요(제품 Phase 1~10, 완료/미검증/외부 설정 필요, 배포 기록).

1. **[맥락 허브](docs/context/README.md)** — 전체 문서 목차와 현재 방향.
2. **[자동 생성 현재 상태](docs/context/_generated/CURRENT_STATE.md)** — 코드의 실제 AI 이름·카테고리·커밋·CI 내역.
3. **[전체게임 오프폴리시 강화학습·PPO 학습량 2배](docs/context/FULLGAME-OFFPOLICY-RESEARCH.md)** — 5계열 구현과 전체게임 실험, 기존 Win DP v2 보존.
4. **[PSRO 오라클·조건부 PMF의 실제 독립 평가](docs/context/EXTENDED-PSRO-PMF-PPO-RESULTS.md)** — 검증된 예측·오라클 대응 성능 및 한계.
5. **[PSRO 오라클·조건부 PMF·PPO 3시드 확대](docs/context/EXTENDED-PSRO-PMF-PPO-RESEARCH.md)** — 실제 검증 프로토콜과 결과 진입점.
6. **[PSRO·PPO·상대 점수 PMF 검증 결과](docs/context/PSRO-PPO-PMF-2026-11-20-FINAL.md)** — 실제 제한게임 7정책 메타게임/전체 PPO/확률분포 성적.
7. **[PSRO·PPO·상대 PMF 최신 실험](docs/context/PSRO-PPO-PMF-RESEARCH.md)** — 실제 학습 방법/결과/한계.
8. **[자기 대국 최신 종합 결론](docs/context/SELFPLAY-2026-11-20-FINAL.md)** — 소형/신경망 자기 대국, 상대 점수 예측, Win DP v3의 성공과 실패 기록.
9. **[검증된 실험 결과](docs/context/RESULTS.md)** — 승률/평균점수/시드/신뢰구간/한계.
10. **[AI 기법 전체 도감](docs/context/TECHNIQUES.md)** — DP·검색·RL·Self-Play·진화·하이브리드.
11. **[연구 로드맵](docs/context/ROADMAP.md)**, **[설계 결정](docs/context/DECISIONS.md)**, **[새 채팅 인수인계](docs/context/HANDOFF.md)**.
12. **[자동 갱신 원칙](docs/context/AUTOMATION.md)**.

## 새 대화에 전달할 한 줄

> https://github.com/oyueo-mm/YachtLab/blob/main/CONTEXT.md 에서 맥락을 읽고 현재 main 소스·실험 기록을 확인한 뒤, 이번 작업을 진행해 줘. 결과와 중요한 새 결정을 docs/context/에 문서화하고 CI·배포 상태까지 보고해 줘.

**자동 갱신 범위:** GitHub에 커밋된 소스·파일·Git 기록과 접근 가능한 Actions 정보. **ChatGPT 채팅 메시지는 자동 수집하지 않음**. 중요한 결정은 작업 중 GitHub 문서에 기록해야 영구 보존됨.
