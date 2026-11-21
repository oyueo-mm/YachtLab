# QR-DQN / IQN 전수 실험 사후 감사 (2026-11-21)

## 실행 완료 사실

- 전체 연구 Actions: https://github.com/oyueo-mm/YachtLab/actions/runs/44838345749 — success.
- 시드별 결과 아티팩트 45개 및 종합 결과 1개 확인. 종합 보고서: [QR-SUITE-LATEST](./_generated/QR-SUITE-LATEST.md).
- 테스트/배포 Actions: https://github.com/oyueo-mm/YachtLab/actions/runs/44838345712 — success.
- 전체 연구가 성공적으로 실행되었다는 사실과 결과의 과학적 타당성은 별개다.

## 주요 수치와 그 해석

- Validation으로 선정된 설정: `q16-loss2-is0` (QR-DQN 16분위수, DP 손실 허용 2점, PER IS 보정 없음).
- 5개 독립 훈련 시드의 확인 대국, Win DP v2 상대 승리 점수율 평균 **50.717%**; 시드 평균 t(4) 95% 구간 **50.299–51.134%**. 이 구간은 5개 시드 평균 변동만 사용한 추정이며 다중 모델 탐색과 경기 내 불확실성을 모두 해소하는 수치는 아니다.
- 미선택 후보 `q16-loss6-is1`의 confirmation 50.933%를 사후 최고값으로 선택해서는 안 된다.
- IQN16 49.683%, IQN32 49.717%, QR16-full-state 44.150%, QR16-baseline 48.567%. 구성과 기존 2026-11-20 파일럿의 초기화/학습 프로토콜은 동일하지 않으므로 이전 51.333%와 단순 비교 금지.

## 감사 중 발견한 두 가지 수정 대상

### A. DP Expert 상대가 이름 그대로의 DP Expert가 아님

`scripts/research-qr-suite.mjs`의 `decision(s,p,random,epsilon)`은 플레이어 유형과 관계없이 자신의 미작성 점수칸 수가 2 이하가 되면 `basicDecision(s,baseline)`을 적용한다. `baseline`은 Win DP v2이므로 **DP Expert로 명명한 상대도 마지막 두 카테고리에서 Win DP v2를 사용**한다. 따라서 현재 DP Expert 상대 validation/confirmation 결과는 pure DP Expert 성적이라고 해석하면 안 된다. `p.kind==="dp"` 대조군을 먼저 처리하는 수정 및 회귀 테스트 후 재평가해야 한다.

### B. 반사실적 평가 원시 결과가 자동 요약에서 소실

`QR16-baseline`은 baseline/improvements/iqn 세 그룹에 중복 존재한다. `scripts/summarize-qr-suite.mjs`가 `id`만으로 5개 시드 맵을 구성하면서 뒤에 처리된 중복 행이 baseline 실험의 `counterfactual` 데이터까지 덮어써, 종합 보고서에 반사실적 결과 행이 0개 출력됐다.

원시 `qr-suite-baseline-seed-0..4` 아티팩트에는 실제로 **시드당 60개 변경 상태 × 상태당 80쌍의 공통난수 rollout**이 있다. 각 시드의 한 행동 개입(이후 모두 DP/Win DP v2 continuation) 평균 승리점수율 차이는 −0.3021, −0.28125, −0.55208, −0.14583, −0.4375%p (시드 0..4), 5시드 평균은 **−0.34375%p**다. 이는 선택된 `q16-loss2-is0`이 아니라 별도 `QR16-baseline`의 비무작위 추출 상태들에 대한 진단 결과로, 정책 전체의 승률 효과나 확증성 검정으로 해석해서는 안 된다. 집계 시 `(group,id,seed)`를 고유키로 보존하고 반사실적 분석 대상 모델을 명시할 필요가 있다.

## 다음 단계 권고

1. 대조군 유형 우선순위와 집계 중복 ID 처리 수정. 단위 테스트 추가.
2. 선택된 `q16-loss2-is0`의 변경 행동에 대해 별도 무작위/층화 상태 샘플, 충분한 공통난수 후속 대국 시행.
3. 수정 전과 수정 후 프로토콜을 혼합하지 말고 검증용/확증용 시드를 새로 발급하여 재현.
4. 바꿀 대상이 Win DP v2이므로 모든 후보의 동등 예산 직접 상대 대국과 시간 비용을 함께 보고. 검증 전 사이트 기본 AI 유지.
