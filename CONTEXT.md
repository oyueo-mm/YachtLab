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

> **재화·상점·퀘스트·업적을 다룬다면** [실서비스 경제](docs/economy/LIVE-ECONOMY.md)부터(M3i-W30 실제 구현·원장·가격표·퀘스트·업적, 결정 D-040~D-042). 연구 배경: [경제 연구 보고서](docs/economy/ECONOMY-RESEARCH.md)(D-029~D-037).
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
