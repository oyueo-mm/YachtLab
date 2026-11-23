# 규칙 확장 설계: 12칸 Yacht Dice + 향후 13칸 Yahtzee 계열

> 상태: **설계 문서만 작성. 구현 없음.** 현재 엔진(`src/engine.ts`)의 12칸 Nintendo-style Yacht Dice 규칙·성능·AI·DP 테이블은 이번 작업에서 바꾸지 않았다. 13칸 엔진·AI·점수표는 만들지 않는다.

## 1. 현재 상태 (코드 기준)

| 영역 | 현재 구현 | 12칸 가정이 들어 있는 곳 |
|---|---|---|
| 카테고리 | `categories` 12개 상수, `Category` 유니온 | `engine.ts`, 점수판·툴팁(`CategoryHelp.tsx`)·아이콘 |
| 점수 | `score(values, category)` 한 함수 | 스트레이트 15/30, 포커=합계, 요트 50 |
| 보너스 | `upper ≥ 63 → +35` (`bonus`) | `BonusProgress`, DP 상태의 상단 합 |
| 경기 종료 | `available(card).length === 0` / `recorded === n * 12` | `engine.ts`, `multi-engine.ts`(`12`), 라운드 표시 `/ 12` |
| 기보 | `format: "YachtLabReplay"`, `version: 1\|2`, `metadata.ruleVersion: "YachtLab-12-v1/v2"` | 검증 시 `ruleVersion` 정확히 일치 요구 |
| 다인전 기보 | `ruleVersion: "YachtLab-12-multi-v1/v2"` | 동일 |
| AI | DP Expert(191.76…), Win DP 계열, 증류·PPO 가중치 | 상태 인코딩(12비트 마스크 + 상단 합 0–63)과 학습 데이터가 12칸 전용 |

`ruleVersion`이 이미 기보에 기록되어 있다는 점이 확장의 출발점이다.

## 2. 규칙 ID와 버전

- **규칙 ID**(`rulesetId`): 게임의 의미를 바꾸는 규칙 묶음. 예) `yacht-12`(현행), `yahtzee-13`(후보).
- **규칙 버전**(`rulesetVersion`): 같은 ID 안에서 점수 의미가 바뀌면 올린다(정수). 버그 수정으로 같은 입력의 점수가 달라지는 경우도 새 버전이다.
- **기보 규칙 문자열**은 기존 형식을 유지하고 매핑한다: `YachtLab-12-v1`, `YachtLab-12-v2`(난수 스트림 차이) → `yacht-12@1`. 기존 문자열은 **절대 재해석하지 않는다**.
- 난수 스트림·기보 포맷 버전(`version: 1|2`)은 규칙 버전과 **별개 축**으로 유지한다.

## 3. 카테고리·점수·보너스 분리 구조 (제안)

```ts
type RuleSet = {
  id: "yacht-12" | "yahtzee-13";
  version: number;
  categories: readonly CategoryDef[];       // 순서 = 점수판 순서
  upperBonus: { threshold: number; points: number } | null;
  extraBonus?: ExtraYachtRule;              // 13칸 계열의 추가 Yahtzee 보너스/조커 규칙
  dice: 5; rollsPerTurn: 3;
};
type CategoryDef = { id: string; section: "upper" | "lower"; score(values: readonly number[]): number; help: HelpText };
```

- 현행 `engine.ts`는 그대로 두고, `yacht-12` RuleSet은 **기존 `score`/`bonus`를 감싸는 어댑터**로 만든다. 성능 민감 경로(DP, Win DP, 벤치마크)는 지금처럼 `engine.ts`를 직접 호출해 오버헤드·결과 변화가 없게 한다.
- 13칸 후보는 Three of a Kind, Four of a Kind(합계), Full House(25), Small/Large Straight(30/40), Yahtzee(50), Chance + 상단 63→+35, 추가 Yahtzee 보너스와 조커 규칙을 별도 RuleSet으로 정의한다. **수치는 12칸과 섞지 않는다**(AGENTS.md 규칙).
- 점수판·툴팁·아이콘은 `CategoryDef` 목록을 순회하도록 바꾸되, 12칸 화면 결과는 픽셀 수준에서 동일해야 한다(회귀 스크린샷).
- 경기 종료·라운드 수는 `categories.length`에서 계산한다(`multi-engine.ts`의 상수 `12` 제거 대상).

## 4. 기보 호환성

| 기보 | 처리 |
|---|---|
| 기존 v1/v2 (`YachtLab-12-…`) | 지금과 동일하게 12칸 엔진으로 재생. 필드 추가 없이 읽기 전용 매핑 |
| 신규 12칸 기보 | 기존 형식 그대로 저장(하위 호환 유지). 필요 시 `metadata.ruleset = "yacht-12@1"`을 **추가 필드**로만 기록 |
| 신규 13칸 기보 | 새 `ruleVersion`(예: `YachtLab-13-v1`) + `metadata.ruleset = "yahtzee-13@1"`. 구버전 앱은 기존 검증 로직에 따라 "지원하지 않는 규칙"으로 거부 → 잘못 재생될 위험 없음 |
| 교차 재생 | 금지. 12칸 기보를 13칸 엔진으로, 또는 반대로 재생하지 않는다. 분기·분석 기능도 같은 규칙 안에서만 허용 |

## 5. 게임 생성 시 규칙 선택

- 로비 → 오프라인 대전 → 모드 선택 다음 단계(또는 게임 화면의 설정)에 "규칙" 선택을 추가. 기본값은 항상 `yacht-12`.
- 선택한 규칙은 `createGame(seed, { ruleset })` 형태로 엔진 생성 시 고정되고, 경기 중 변경 불가.
- 온라인(별도 PR #44의 서버 엔진)은 `matchCreated` 이벤트에 `ruleset`을 기록하고 서버가 검증한다. 현재 온라인 엔진도 12칸만 지원한다.
- URL 해시(`#play` 등)는 유지하고 규칙은 상태로만 전달해 기존 딥링크가 깨지지 않게 한다.

## 6. AI 모델과 규칙 버전 호환성

- 각 AI에 `supportedRulesets: ["yacht-12@1"]`을 명시하는 **호환성 매니페스트**를 둔다. 난이도 선택·연구실 목록은 현재 규칙과 호환되는 AI만 보여 준다.
- DP 테이블·증류/PPO 가중치·벤치마크 결과는 **규칙 ID@버전별로 분리 저장**한다(`dp-manifest.json`에 `ruleset` 필드 추가). 12칸 결과(예: DP Expert 191.760879752165)를 13칸 결과와 비교·합산하지 않는다.
- 13칸 지원 시 최소 요건: (1) 13칸 단독 기대점수 DP 재계산, (2) 규칙별 회귀 테스트, (3) 결과 문서에 규칙 ID 명시. 기존 12칸 모델의 가중치·테이블은 덮어쓰지 않는다(D-003).
- 호환되지 않는 AI를 고르면 숨기거나 비활성화하고 이유를 표시한다. 자동 변환은 하지 않는다.

## 7. 단계별 이행안 (향후)

1. RuleSet 타입과 `yacht-12` 어댑터 도입 + 기존 테스트 전부 통과(동작 변화 0).
2. UI(점수판·툴팁·라운드 수)를 RuleSet 순회 방식으로 전환 + 12칸 스크린샷 회귀.
3. 기보 `metadata.ruleset` 추가 필드(선택) + 교차 재생 거부 테스트.
4. `yahtzee-13` 엔진·점수 테스트(독립 구현과 교차 검증) → 전용 DP → AI 호환 매니페스트.
5. 로비에 규칙 선택 노출.

## 8. 2차 개편에서 마련한 구조 (2026-11-23)

- **규칙 레지스트리** `src/rulesets.ts`: `{ id, version, name, summary, available }`. 현재 `yacht-12@1`만 `available: true`. 13칸은 `available: false`로 상세 설정 화면에 "준비 중"(선택 불가)으로만 보이며 게임 시작에 사용할 수 없다.
- **상세 설정 데이터** `src/setup.ts`: AI·로컬 설정에 `ruleset` 필드가 있고, 저장값이 미구현 규칙이면 `yacht-12`로 되돌린다(단위 테스트로 고정). 게임 생성은 아직 `yacht-12` 엔진만 호출한다.
- 선공 선택은 엔진 변경 없이 **좌석 배치**로 구현했다(먼저 하는 플레이어가 항상 엔진 좌석 0). 따라서 향후 규칙 엔진도 "좌석 0부터 시작"이라는 같은 계약을 유지하면 된다.

## 9. 향후 커스텀 규칙 항목별 설계 메모 (미구현)

| 항목 | 들어갈 위치 | 기보·AI 영향 |
|---|---|---|
| 13칸 Yahtzee 계열 | 별도 RuleSet(카테고리·점수·보너스) | 새 `ruleVersion`, 전용 DP·AI 필요 |
| 턴별 제한 시간 | 규칙이 아닌 **경기 옵션**(점수 계산 불변). 온라인 엔진(PR #44)의 `turnTimeoutMs`와 같은 개념 | 기보 메타데이터에 기록, AI 영향 없음 |
| 최대 굴림 횟수 변경 | RuleSet `rollsPerTurn` | 기대점수·DP가 달라지므로 별도 규칙 버전, 12칸 DP 재사용 금지 |
| 요트 조커 | RuleSet `extraBonus` | 점수 계산 변경 → 새 버전, AI 호환 매니페스트 갱신 |
| 상단 보너스 기준·점수 | RuleSet `upperBonus` | 새 버전, DP 상태 공간(상단 합 상한) 변경 |
| 기타 커스텀 | `yacht-12` 파생 ID(`yacht-12-custom@hash`)로 명시 | 연구 결과·순위표와 분리 |

원칙: **점수 결과를 바꾸는 옵션은 모두 새 규칙 버전**이고, 점수에 영향이 없는 진행 옵션(시간 제한·연출 속도 등)은 경기 옵션으로 분리한다. 미구현 규칙은 플레이 가능한 선택지처럼 표시하지 않는다.

