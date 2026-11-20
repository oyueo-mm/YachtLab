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

1. **[맥락 허브](docs/context/README.md)** — 전체 문서 목차와 현재 방향.
2. **[자동 생성 현재 상태](docs/context/_generated/CURRENT_STATE.md)** — 코드의 실제 AI 이름·카테고리·커밋·CI 내역.
3. **[PSRO·PPO·상대 점수 PMF 검증 결과](docs/context/PSRO-PPO-PMF-2026-11-20-FINAL.md)** — 실제 제한게임 7정책 메타게임/전체 PPO/확률분포 성적.
4. **[PSRO·PPO·상대 PMF 최신 실험](docs/context/PSRO-PPO-PMF-RESEARCH.md)** — 실제 학습 방법/결과/한계.
5. **[자기 대국 최신 종합 결론](docs/context/SELFPLAY-2026-11-20-FINAL.md)** — 소형/신경망 자기 대국, 상대 점수 예측, Win DP v3의 성공과 실패 기록.
6. **[검증된 실험 결과](docs/context/RESULTS.md)** — 승률/평균점수/시드/신뢰구간/한계.
7. **[AI 기법 전체 도감](docs/context/TECHNIQUES.md)** — DP·검색·RL·Self-Play·진화·하이브리드.
8. **[연구 로드맵](docs/context/ROADMAP.md)**, **[설계 결정](docs/context/DECISIONS.md)**, **[새 채팅 인수인계](docs/context/HANDOFF.md)**.
9. **[자동 갱신 원칙](docs/context/AUTOMATION.md)**.

## 새 대화에 전달할 한 줄

> https://github.com/oyueo-mm/YachtLab/blob/main/CONTEXT.md 에서 맥락을 읽고 현재 main 소스·실험 기록을 확인한 뒤, 이번 작업을 진행해 줘. 결과와 중요한 새 결정을 docs/context/에 문서화하고 CI·배포 상태까지 보고해 줘.

**자동 갱신 범위:** GitHub에 커밋된 소스·파일·Git 기록과 접근 가능한 Actions 정보. **ChatGPT 채팅 메시지는 자동 수집하지 않음**. 중요한 결정은 작업 중 GitHub 문서에 기록해야 영구 보존됨.
