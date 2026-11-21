# QR-DQN 4대 개선 실험 결함 감사 — 2026-11-21

## 판정

- **실행 성공이지만 실험 성적은 무효.** 해당 Actions: https://github.com/oyueo-mm/YachtLab/actions/runs/44871846426 (source SHA c5a466de7912fba8e0422c102447d22d44513a50).
- 10개 구성 × 5훈련 시드가 정상 종료됐다는 사실은 유지하나, 신경망이 정상적으로 업데이트됐다는 결론과 5k/20k 승률 비교는 철회한다.
- **직접 관찰된 원시 증거:** `qr-factorial-results-richStable-3` 아티팩트의 JSON에서 첫 1,000게임 체크포인트의 encoder 전체 **2,528개 항목이 null**로 직렬화되어 있었다. JSON 문자열 변환은 NaN을 null로 기록한다.

## 원인

`scripts/train-qr-factorial.mjs`에서 `conf.gamma`를 TD target의 `reward+gamma*target_distribution`에 사용했지만, 10개 configuration 객체 모두에 `gamma`가 정의되어 있지 않았다. 0.99 같은 기본값도 지정되지 않았다.

따라서 중간 보상만 있는 비종단 transition에서 `undefined × value → NaN`; 분포 출력 갱신에 비유한 수치가 전파되면서 encoder/head weights가 NaN으로 오염되었다. JSON serialize 후 null로 바뀌었고, 이후 체크포인트 평가가 이를 정상 모델처럼 취급했다. 이 탓에 거의 모든 구성 성적이 정확히 같은 숫자로 나왔을 가능성이 높다. 정상적인 하이퍼파라미터 비교가 이루어지지 않았다.

## 결과 조치

- 2026-11-21 원래 보고서 `QR-FOUR-PILLARS-LATEST.md`의 **모든 모델 승률·gate 채택량은 유효한 성능 연구 수치에서 제외한다.** 실험 475,000게임은 시작됐지만 정상적인 QR-DQN 학습 475,000게임이라고 인용하면 안 된다.
- 새 러너에서 `gamma=0.99`를 명시하고, 중요도/TD target·모델 가중치·행동 logit이 NaN/Infinity일 경우 즉시 실패하도록 검증한다.
- 자동 단위 테스트에 NaN/JSON null 체크포인트 회귀 검사를 추가한다.
- 고정된 실험 정의와 사전 독립 평가 절차를 그대로 사용해 **수정 이후 완전히 새로 훈련**한 결과만 유효한 연구 자료로 채택한다.
- 기본 사이트 Win DP v2는 변경되지 않았다.
