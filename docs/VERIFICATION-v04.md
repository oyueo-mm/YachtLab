# YachtLab v0.4 검증 기록

2026-10-28, 기능 브랜치 `feat/v04-ai-research-and-replay`에서 실제 실행했다.

| 검사 | 결과 |
|---|---|
| `npm test` | Vitest 8개 파일, 46개 테스트 통과 |
| `python training/test_env.py` | 3개 테스트 통과 |
| `npm run build` | TypeScript 검사와 프로덕션 빌드 통과 |
| `npm run test:ui` | 69개 통과, 데스크톱의 터치 전용 1개 제외 |
| `python training/audit_distillation.py` | 데이터 해시, 고정 체크포인트 지표, 평가 시드 분리 확인 |
| `node scripts/check-v04-pairs.mjs` | 좌석 교대 실제 대국 300건의 점수가 짝 비교 결과와 모두 일치 |
| `node scripts/browser-distilled.mjs` | 실제 Worker 추론·준비 시간 4종 × 100회 측정 |

브라우저 검사는 데스크톱 1440×1000과 Pixel 7 에뮬레이션에서 수행했다. 추가로 320px 가로 배치와 기보 모달 내부의 가로 넘침을 확인했다. 실제 모바일 하드웨어 성능 측정은 아니다.

확인한 흐름:

- 커스텀 선택창의 키보드·포커스·외부 클릭·모바일 경계·비활성화와 난이도 표시
- 기존 홈 시연, 백그라운드 정지, 모션 감소, 드래그·키보드 정렬, 12라운드 경기, 재대결·취소·재시도
- AI 행동의 단계 표시, 재대결 중 타이머 정리, 백그라운드 정지 및 복귀
- 진행 중 기보 저장, IndexedDB 목록·이름 변경·삭제, JSON 왕복, 잘못된 JSON·상태·난수·행동 거부
- v0.3 기보 가져오기, 중간 고정 상태에서 분기 완주, 전체 과거 기록·고정·RNG 보존, 원본 객체 불변
- 기보를 보는 동안 대국 정지와 닫은 뒤 재개, 실제 행동 직전 상태를 분석실로 전달
- 임의 합법 행동의 DP Bellman 가치, 대칭 고정의 동일 가치, 불법 행동 마스크
- 두 학습 모델의 PyTorch/TypeScript 확률 일치, 고유 ID 매핑, 표시 순서 독립성, 모델 SHA-256, 실제 Worker 대국 완주
- 홈에서 새 가중치를 요청하지 않고 선택한 모델만 나중에 로드, 연구 결과·학습 곡선 표시

`src/engine.ts`, 기존 `src/ppo-model.json`, DP 커널·manifest·가치 테이블은 기존 커밋 대비 변경하지 않았다. 새 모델은 각각 별도 JSON으로 보존했다. 대용량 학습 데이터·체크포인트는 로컬에만 유지한다.

[실험 설정과 원시 평가·신뢰구간·승률·곡선](../benchmarks/v04/REPORT.md), [기보 및 공통 평가 설계](REPLAY.md).

GitHub Actions는 main에서 단위 검사·타입/빌드·전체 브라우저 검사를 재실행한 뒤 GitHub Pages에 배포한다. 공개 사이트는 `scripts/smoke.mjs`로 홈·DP 대국·새 모델 대국·기보 JSON 왕복·아레나 분기·학습 곡선·해시 새로고침을 확인한다.
