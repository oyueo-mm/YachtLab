# v5-R · PMF 은행 · 분석 API v6 — 제품 통합 인수인계 (Codex용, 2026-11-25)

> 대상: 제품 통합을 맡은 에이전트(Codex). 이 문서는 연구 결과 중 **제품에 바로 옮길 수 있는 것**과 그 계약만 정리한다. 연구 배경은 [V6-APEX-RESEARCH](./V6-APEX-RESEARCH.md), 결정은 D-V5-1과 D-V6-1(DECISIONS.md).
>
> 이번 연구 PR(#75, #79)은 `src/ai.ts`, 기본 AI, 난이도, 제품 UI를 **바꾸지 않았다.** 아래 내용은 모두 연구 모듈(`src/research-v5/`, `src/research-v6/`)에 있다. 제품에 연결할지와 그 시점은 별도 PR에서 정한다.

## 1. 모델 역할 (확정)

| 역할 | 모델 | 근거 | 제품 반영 |
|---|---|---|---|
| **제품용 경량 후보** | **v5-R** (`winDPv5Decision`, `endgame: "none"`) | 확증 9501: vs Win DP v2 50.626%(100k), vs DP Expert 51.223%. 판단 0.07 ms. 은행 1개 | 아직 등록하지 않음. 등록하려면 아래 §5 점검 필요 |
| 연구 최강 후보 | v6-P (`winDPv6Decision`, 은행 7개) | 확증 9511: vs v5-R 50.131%(100k), 재현 9512 50.209%. 공통 상대 이득은 미확정, Elo 약 +1 | **제품 미사용.** 은행 7개(Float64 2.1 GB, Float32 약 1 GB)라 브라우저·모바일에 부적합 |
| 기본 AI / 난이도 | 기존 그대로 | — | 변경 금지(사용자 지시) |

## 2. PMF 은행을 얻는 두 가지 경로

v5-R은 DP Expert의 정확한 미래 점수 PMF 은행(정규화 상태 199,744개, 값 37,256,480개)이 필요하다. 원본은 Float64 299 MB다.

### 2.1 경로 A — 브라우저에서 WASM으로 직접 생성(추천: 다운로드 0)

- **파일:**
  - `training/v6-wasm/pmf.wasm`(7 KB, import 없음). 소스는 `training/v6-wasm/pmf_wasm.c`이고, `clang --target=wasm32 -O3 -mbulk-memory -nostdlib -Wl,--no-entry`로 빌드한다.
  - 드라이버: `src/research-v6/wasm-pmf.ts`
- **API:**
  ```ts
  import { buildBankWasm, bankFromWasm } from "src/research-v6/wasm-pmf";
  const r = await buildBankWasm(wasmBytes, dpTable /* Float64Array 262144 */, { f32: true });
  const bank = bankFromWasm(r); // PolicyPmfBank 모양: bank.get(mask, u), bank.meanOf(mask, u)
  ```
- **`dpTable`:** `dp.ts`가 쓰는 배포 자산(`public/ai/<dp-manifest.asset>`, gzip)을 푼 Float64Array와 같은 바이트다.
- **정확성:** Float64 모드는 TS 은행과 **비트 단위로 같다**(테스트 `tests/research-v6-integration.test.ts`, 측정 `wasm-bench.ts`). Float32 모드는 내부 누적을 double로 하고 저장만 float로 하며, 최대 TV는 3.1e-8이다.
- **측정값:**

| 환경 | 생성 시간 | WASM 메모리 | 비고 |
|---|---:|---:|---|
| Node 22 | 7.99 s | 288 MB(f64) / 146 MB(f32) | — |
| 데스크톱 Chromium 158 Web Worker | 8.1 s | 같음 | 메인 스레드는 응답 유지 |
| 실기기 모바일 | 미측정 | — | CDP 감속은 워커에 적용되지 않아 에뮬레이션 수치를 쓸 수 없음 |

- **권장 구조:** 은행은 **워커 안에 둔다.** 메인 스레드로 146 MB를 복사하지 말고, 워커가 `winDPv5Decision`(0.07 ms)과 분석 요청에 메시지로 답하게 한다.
- **번들 주의:** `kernel.ts`가 `dp-kernel.json`(주사위 커널)을 import한다. 워커 번들에 함께 들어가며, `dp.ts`도 이미 쓰는 자산이다.

### 2.2 경로 B — 미리 만든 은행 파일 다운로드(`YPB1` 형식)

- **파일:** `src/research-v6/bank-codec.ts`의 `encodeBank(bank, "f32" | "int16")`와 `decodeBank(arrayBuffer)`. 디코드 결과는 PolicyPmfBank 모양이다.
- **형식(리틀 엔디언):**

| 구간 | 내용 |
|---|---|
| 헤더 | `u32 "YPB1"`, `u32 kind`(1 = f32, 2 = int16), `u32 states`, `u32 floats` |
| 인덱스 | `(i32 key, i32 len) × states` |
| 스케일 | int16만: `f32 scale × states` |
| 본문 | `f32` 또는 `u16` 페이로드. int16 값 = q / 65535 × scale |

| 형식 | 원본 | gzip -9 | 디코드 | 최대 확률 오차 | 실제 결정 영향(4,023국면) |
|---|---:|---:|---:|---:|---|
| Float32 | 143.6 MB | 111.7 MB | 85 ms | 2.9e-8 | **실질 불일치 0**, 최대 손실 3.3e-10 |
| INT16(상태별 스케일) | 73.3 MB | **42.6 MB** | 158 ms | 5.4e-6 | 불일치 0.10%, 최대 손실 5.9e-7 |
| INT8 / Float16 / 신경망 증류 | — | — | — | — | **사용 금지**(불일치 0.45~4.8%) |

원시 결과: `training/results/v6/codec-sizes.jsonl`, `quant-study.jsonl`, `distill-*.json*`. 은행 파일을 만드는 Node 쪽 흐름은 다음과 같다.

```ts
import { loadDPExpertBank } from "scripts/research-v5/bank-io";
import { encodeBank } from "src/research-v6/bank-codec";
const { bank } = loadDPExpertBank();          // 처음 실행이면 생성 후 git 제외 캐시에 저장(약 10~60 s)
const ypb1 = encodeBank(bank, "int16");       // 또는 "f32"
```

- **선택 기준:**
  - 메모리 여유가 있으면 Float32를 쓴다(경로 A f32 생성, 또는 경로 B f32).
  - 저사양 기기는 INT16 다운로드 42.6 MB를 쓴다. 디코드하면 Float32 메모리 약 142 MB가 필요하다.
- **캐시:** IndexedDB 또는 OPFS 저장은 **구현하지 않았다.** 은행 버전 키는 DP 자산 해시(`dp-manifest.json`의 asset)와 형식 kind의 조합을 권장한다.

## 3. 의사결정 호출 (v5-R)

```ts
import { winDPv5Decision } from "src/research-v5/apex";
const view = { ...state, seed: 0, rng: [0, 0] };   // 공정성 경계: 엔진 RNG/seed를 지운 사본만 전달
const d = winDPv5Decision(view, { bank, dpValue: (m, u) => dpTable[m * 64 + u], endgame: "none" });
// d.type === "score" → d.category, d.type === "reroll" → d.ids(고정할 주사위 id; 엔진 "hold" 액션과 같음)
```

- 굴림 전 상태(`rolls === 0`)에서는 호출하지 않는다(예외 발생).
- v5-R은 점수판, 주사위 눈, 굴림 횟수, 차례만 읽는다.
- 확증된 v5-R 구성은 `endgame: "none"`이다. `"minimax"`(v5-B3)는 판단 p99 9.3 ms, 최대 382 ms이고 이득이 미확정이다.

## 4. 복기 분석 API

| API | 위치 | 상태 | 용도 |
|---|---|---|---|
| `analyzePosition`, `rerollDistribution` (v5) | `src/research-v5/analysis.ts` | **변경 없음**(호환 유지) | 기존 계약 |
| `analyzeV6`, `decomposeStep` (`yachtlab-analysis-v6`) | `src/research-v6/analysis6.ts` | 신규 | 승·무·패 확률, 굴림 전 가치, 결정 손실과 운 분해, 모델 메타데이터 |

필드 계약은 [V6-APEX-RESEARCH §8](./V6-APEX-RESEARCH.md#8-복기용-분석-api--yachtlab-analysis-v6-codex-ui-계약), 예제는 [examples/analysis-v6-example.json](./examples/analysis-v6-example.json)에 있다.

**제품(브라우저)에서는 은행 1개로 쓴다.** `cfg.banks = [dpBank]`로 넘기면 정책군 롤아웃이 v5-R 롤아웃과 같아진다(테스트로 동일성 확인). 은행 7개짜리 v6-P 가치는 서버나 연구 환경에서만 쓴다.

```ts
import { analyzeV6, V6_LIVE, V6_REVIEW } from "src/research-v6/analysis6";
const cfg = { bank, dpValue, endgame: "none", banks: [bank] } as V6Config;
const a = analyzeV6(view, cfg, V6_LIVE, playedAction);   // 실시간: 깊이 1, ≤4칸 전 구간 BR, 약 5 ms
const r = analyzeV6(view, cfg, V6_REVIEW, playedAction); // 복기: 깊이 2, ≤6칸 BR, 양측 ≤3칸 정확 상호작용, 수십 ms~
```

**표시 규칙:**
- `exactness.kind`가 `"exact-interactive"`일 때만 "정확"으로 표시한다. 나머지는 "모델 추정"으로 표시한다(측정된 낙관 편향 0.1~1%p, §3.2).
- `pWin`, `pTie`, `pLoss`는 정확 상호작용 단계에서 `null`이다.
- 행동 단위는 **재굴림 확정 시점의 고정 집합**이다. 개별 킵 토글은 행동이 아니다.
- `decomposeStep`(결정 손실과 운)은 공개 상태 두 개만 쓴다. 미래 RNG나 시드는 쓰지 않는다.

## 5. 제품 통합 전 점검 목록

1. **비열등성:** 제품에 넣는 구성(예: v5-R + INT16)으로 Float64 v5-R 대비 직접 대결을 새 확증 시드 9521~에서 실행한다. 결정 수준 실질 불일치가 0.1%라 차이는 측정 한계 이하로 예상되지만, 대국으로 확인한다.
2. **실기기 모바일:** WASM 생성 시간, 최대 메모리, 백그라운드 탭 중단, 저장소 할당량(IndexedDB/OPFS)을 측정한다.
3. **공정성 경계:** 워커로 넘기는 상태에서 `seed`와 `rng`를 지운다(bench.ts와 같은 방식).
4. **회귀:** `npm test`(v5/v6 연구 테스트 포함), `npm run build`, Playwright를 실행한다.
5. **기본 AI와 난이도는 그대로 둔다.** v5-R은 새 선택지로만 추가하고, 노출 여부는 사용자 결정이다.

## 6. 알려진 한계

- 모바일 실측이 없다. 은행 생성 8 s는 데스크톱 기준이다.
- IndexedDB/OPFS 캐시와 지연 로딩은 미구현이다.
- WASM SIMD 이득은 없다(자동 벡터화). 성능 개선 여지는 생성 루프 구조 쪽에 있다(Rust 3.5 s, C++ 3.0 s 참고).
- v6-P는 메모리 때문에 제품용이 아니다. 연구 최강 후보로만 유지한다.
