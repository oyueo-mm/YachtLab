# 프로젝트의 핵심 결정사항 (ADR 요약)

2026-11-20 현재 확인된 코드/연구 문서 기준. 이후 결정이 바뀌면 신규 항목을 추가하고 옛 결정의 상태를 Deprecated로 표기한다.

## D-001. 게임 규칙은 닌텐도식 12칸 Yacht Dice

**상태: 유지.** 주사위 5개, 턴당 최대 3회 굴림, 12카테고리(1~6, Choice, Four-of-a-kind, Full House, Small Straight, Large Straight, Yacht), 상단 ≥63점 +35점. 포커: 4개 이상 같으면 주사위 합. 풀 하우스: 정확한 3+2, 다섯 개 같은 눈은 해당하지 않음. 스몰/라지: 15/30, 요트 50. 미국식 13칸 Yahtzee와 섞지 않음.

**근거:** src/engine.ts, training/dp/README.md.

## D-002. 연구 목표를 단독 점수와 경쟁 승률로 분리

**상태: 유지.** 단독 게임 DP Expert는 공정 독립 난수 규칙에서 최대 기대점수 솔버. 최초 기대점수 191.760879752165. 2인전은 승리 1·무승부 0.5·패배 0의 승리 점수율. 기대점수가 높은 정책이 반드시 승률 높은 정책은 아님.

**근거:** src/dp.ts, src/win-dp.ts, src/competitive-v2.ts.

## D-003. 강한 기존 모델을 보존하고 경쟁형 후보를 별도로 추가

**상태: 유지.** DP Expert, Win DP(v1), Win DP v2를 별도 이름으로 유지. v1은 마지막 1개, v2는 마지막 2개 카테고리의 경쟁 목적을 반영. 기존 DP 테이블이나 PPO 학습 가중치를 근거 없이 덮어쓰지 않음. 연구용 MCTS와 QR-DQN Choice는 성능이 미입증이라 기본 AI 목록에서 제외.

**근거:** src/ai.ts, src/competitive-v2.ts, docs/INTEGRATED-RESEARCH.md.

## D-004. 난수 예측 누출 금지

**상태: 매우 중요.** Game 구조에 seed/rng 필드가 있지만 경쟁 AI의 결정이 미래 눈을 예측하도록 이용하면 불공정함. 현재 연구용 에이전트는 공개 주사위/카드 상태를 사용하도록 작성되었지만 **게임 상태 전달 경계에서 개인 RNG·seed를 제거하는 구조적 개선**은 후속 보안·공정성 과제. 테스트에서 시드/PRNG를 바꿔도 결과가 동일해야 하는 경우를 검증.

**근거:** src/engine.ts, src/competitive-v2.ts, tests/dp.test.ts.

## D-005. 승률 비교는 동일 규칙·선후공 교대·홀드아웃

**상태: 유지.** 동일 시드에 대해 선후공을 뒤집은 두 경기의 승리 점수율 평균을 하나의 paired observation으로 본다. 약 95% 정규 근사 CI를 계산하고 원시 대국 로그를 아티팩트로 보관. 시드 재사용·선택 편향·다중 후보 비교를 최종 증명으로 과대평가하지 않음. 같은 초기 시드여도 행동에 따라 소비 난수 수가 달라지므로 **매번 동일한 주사위 경로**가 아님.

**근거:** scripts/research-competitive.mjs, scripts/confirm-v2.mjs.

## D-006. 상대 모델은 가정된 정책임을 표시

**상태: 유지.** Win DP(v1/v2) 상대 점수분포는 상대가 DP Expert 정책을 따르는 경우에 조건부로 계산된다. 상대가 사람/다른 AI이면 정확하다고 단정하지 않음. 더 넓은 상대집합에서 게임 이론적 최적해를 얻은 것은 아니다.

**근거:** src/win-dp.ts, src/competitive-v2.ts.

## D-007. 자동 맥락은 '사실만' 생성

**상태: 신규.** GitHub Push/정기 갱신에 따라 버전, 알고리즘 이름, 점수 카테고리, 커밋, 문서·워크플로 링크를 자동 인덱싱한다. 연구 내용의 해석이나 새 채팅 대화 내용은 AI 환각 없이 자동 생성할 수 없으므로, 검증된 RESULTS/ROADMAP/DECISIONS은 변경 PR을 통해 유지한다. GitHub Wiki는 **옵션 미러**이며 원본 저장소 문서가 source of truth.

## D-008. 배포 방식과 롤백

**상태: 유지.** 브랜치 → PR → Vitest/TypeScript 빌드/Chromium Playwright → main 병합 → Pages 배포. 새로운 모델은 검증 상태가 명확해야 하며, 기존 사용자를 대상으로 하는 기본 모델을 임의 교체하지 않는다. 문제가 있으면 마지막 정상 커밋으로 revert 할 수 있어야 한다.

**근거:** .github/workflows/deploy.yml.
