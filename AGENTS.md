# YachtLab 개발 에이전트 기본 규칙

이 파일은 코딩 에이전트가 새로운 작업 환경에서도 프로젝트 맥락을 신뢰성 있게 읽도록 하는 작업 지침이다.

## 시작 전 필독

1. CONTEXT.md, docs/context/README.md 및 docs/context/_generated/CURRENT_STATE.md를 읽는다.
2. docs/context/RESULTS.md, ROADMAP.md, TECHNIQUES.md, DECISIONS.md를 읽고 *현재 main 실제 코드*와 대조한다.
3. 충돌 시 코드와 재현 가능한 성공한 CI/실험 결과를 우선한다. 새로운 대화의 추측을 이미 검증된 사실처럼 적지 않는다.
4. 모든 실험의 게임 규칙은 12칸 Nintendo-style Yacht Dice이며, 미국식 Yahtzee 수치와 혼용하지 않는다.

## 구현·검증·배포

- 단독 기대점수와 상대 승리 점수율은 다른 목표다. DP Expert는 기대점수 기준선이며 Win DP 계열은 1:1 승률 목적이다.
- 기존 모델과 가중치/DP 테이블을 보존하고 새로운 후보를 별도 이름으로 추가한다.
- RNG/seed 등 비공개 게임 엔진 상태를 모델이 읽어 미래 주사위를 예측하면 불공정하다. AI 입력 관측 경계를 별도로 점검한다.
- 가능하면 한 요청에 연구 여러 후보를 구현·평가·문서화한다. 단계별 사용자 지시를 불필요하게 반복 요구하지 않는다.
- CI: npm ci, npm test, npm run build, Playwright. 성공한 경우에만 PR 병합·Pages 배포. 롤백 가능한 커밋을 유지한다.
- 성능: 상대, 모델 커밋, 주사위 규칙, 평가 시드, 승리점수율(무승부 0.5), 선후공, 근사 신뢰구간, 평균 점수, 실행 비용을 보고한다.
- 학습·개발·모델 선택에 사용한 시드를 최종 신규 홀드아웃이라고 부르지 않는다.

## 작업 완료 후 맥락 갱신

- 새로 확인한 실험 수치 → docs/context/RESULTS.md, 관련 원시 근거 링크.
- 새 아이디어/후보/우선순위/완료 상태 → docs/context/TECHNIQUES.md 및 ROADMAP.md.
- 규칙/배포/학습/측정 방법의 결정 변경 → docs/context/DECISIONS.md.
- GitHub Actions가 docs/context/_generated/를 갱신하므로 generated 파일을 수동으로 편집하지 않는다.
- ChatGPT 대화 자체의 자동 GitHub 동기화는 없으며, 중요한 결정을 반영하려면 이를 실제 커밋에 포함한다.

See also: docs/context/HANDOFF.md, docs/context/AUTOMATION.md.
