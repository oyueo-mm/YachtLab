# Online Yacht 독립 감사 후속

2026-11-26 KST. 기준 [main de312e8](https://github.com/oyueo-mm/YachtLab/commit/de312e8ec069e2c98b70cf1292a8c18510ba301c). [첫 감사](https://github.com/oyueo-mm/YachtLab/tree/codex/independent-launch-audit-20261126/docs/audits/2026-11-26)

| 결과 | 내용 |
|---|---|
| [성능 비교](performance.md) | 초기 DOM·3D 지연·SW 지연·청크 분리, 조건당 3회와 WebGL 워밍업 구간 |
| [접근성·서버 회귀](server-validation.md) | ARIA 후보, 서버 AI 계산 캐시, 기존 제한 회귀의 이벤트 동기화 |
| [무료 수용량](capacity.md) | 실제 종료 방 잔류, 재대결 재사용, 일일 예산, 50실 모델 |
| [연구 인프라](research.md) | 기존 파일 충돌 재현, 시드 범위, SHA-256 매니페스트와 체크포인트 프로토타입 |
| [PR #94 재검증](post-94.md) | 실제 병합 상태와 격리 통합 확인 |

제품 후보는 3D 킵 선반의 장식 속성과 서버 검증 AI 계산 중복에 한정했다. 제한 회귀는 테스트 관측만 변경했다. 성능의 2.5D·PWA·번들 변형은 로컬 프로파일에서 비교했다. 방과 연구 프로토타입은 제품 런타임·기존 대국 실행기·워크플로와 분리했다.

## 재현 명령

감사 브랜치와 소스 기준선 de312e8을 별도 worktree로 준비하고 각각 npm ci를 실행한다. 아래 명령은 감사 브랜치에서 실행한다. 아래 경로는 예시이며 새 출력 디렉터리를 사용한다. Lighthouse 13.6.0 설치 경로의 lighthouse 패키지 디렉터리를 환경 변수로 전달한다. 모바일과 데스크톱 측정은 다른 작업을 동시에 띄우지 않고 실행한다.

```sh
audit=docs/audits/followup-2026-11-26
YACHT_SOURCE_CHECKOUT=/path/to/clean-baseline python "$audit/build-variants.py" /tmp/yacht-perf
YACHT_LIGHTHOUSE_ROOT=/tmp/yacht-lh/node_modules/lighthouse node "$audit/profile-variants.mjs" /tmp/yacht-perf
YACHT_DESKTOP=1 YACHT_LIGHTHOUSE_ROOT=/tmp/yacht-lh/node_modules/lighthouse node "$audit/profile-variants.mjs" /tmp/yacht-perf
node --import tsx "$audit/compare-server-ai.mjs" /path/to/clean-baseline
node "$audit/room-model.mjs"
node --test "$audit/checkpoints.test.mjs"
npm test -- --maxWorkers=1 tests/online-ai.test.ts tests/online-host.test.ts tests/online-multi.test.ts tests/online-server.test.ts tests/online-worker.test.ts
```

기준 소스와 후보의 로컬 빌드를 다른 포트에서 열고 YACHT_AXE_SCRIPT에 axe-core의 브라우저 JS 경로를 주면 check-dice-aria.mjs에 기준 URL과 후보 URL을 차례로 전달해 오류와 킵 버튼을 재검증할 수 있다.
