# FX-1 → UI-2 / 01 연동 문서: `FxPreview`·정적 썸네일·재질 표 (2026-11-28)

> 대상: UI-2(상점 개편), 01(경기 화면). 작성: FX-1(담당 03). 상위 문서 [FX1-DICE-BOARD-SOUND](./FX1-DICE-BOARD-SOUND-2026-11-28.md).
> 원칙: FX-1은 **표현 컴포넌트와 미리보기 인터페이스**만 소유한다. 상점의 배치·문구·버튼·탭·필터·카드는 UI-2 소유이며, 아래 §4의 변경 외에는 상점 UI를 더 바꾸지 않는다.

## 1. 진입점

```ts
import { FxPreview, previewLevel, loadDiceThumbnail, diceMaterialSpec,
         type FxPreviewHandle, type FxPreviewProps, type FxMoment, type FxPreviewSound } from "src/fx-preview";
```

| 내보내기 | 종류 | 무게 | 용도 |
|---|---|---|---|
| `FxPreview` | React 컴포넌트 (`ref` → `FxPreviewHandle`) | 3D 테이블은 기존처럼 지연 청크 | 상품 상세의 실제 굴림 무대 |
| `previewLevel(id, lv)` | 함수 | 가벼움 | 아이템 최대 단계로 레벨 자르기 |
| `loadDiceThumbnail()` | `() => Promise<(look, px?, opts?) => Promise<string \| null>>` | three.js 지연 로드 | 카드용 정적 3D 썸네일 |
| `diceMaterialSpec(look, id?)` | 순수 함수 | 가벼움(three 없음) | 재질 분류(배지·필터·설명 문구 등) |

## 2. `FxPreview` API

### Props

| prop | 타입 | 기본값 | 설명 |
|---|---|---|---|
| `dice` | `string \| null` | 없음(클래식) | 주사위 아이템 ID |
| `diceLevel` | `number` | 1 | 1~3, 아이템 최대 단계로 자동 제한 |
| `board` | `string \| null` | 없음(기본 보드) | 보드 아이템 ID |
| `boardLevel` | `number` | 1 | 1~3 |
| `autoRoll` | `boolean` | `true` | 주사위·보드·단계가 바뀌면 한 번 굴림. 동작 줄이기·`motionLevel() !== "full"`이면 굴리지 않음 |
| `renderer` | `"3d-high" \| "3d" \| "2.5d" \| "none"` | 설정값(`diceRenderer`) | 비교용 강제. 지정하지 않으면 경기와 같은 규칙(WebGL 없음·동작 간단히 → 2.5D) |
| `sound` | `boolean` | `true` | `false`면 미리보기 전체 무음(전역 음소거·음량은 항상 우선) |
| `className` | `string` | — | 바깥 `<section>`에 추가 |
| `label` | `string` | `"미리보기 보드"` | 접근성 이름(region) |
| `onRolled` | `(values: number[]) => void` | — | 굴림 결과 면(미리보기용) |

같은 컬렉션 주사위+보드면 시너지가 자동으로 켜진다(강도 = 두 단계 중 낮은 값, 경기와 동일).

### Handle (`ref`)

| 메서드 | 동작 |
|---|---|
| `roll()` | 실제 굴림(킵한 주사위 제외). 주사위를 클릭/탭하면 킵 |
| `moment("yacht" \| "straight" \| "win")` | 요트·라지 스트레이트로 **착지하는 굴림** → 경기와 같은 `YachtFlash`/`StraightFlash`·보드 반응·소리. `win`은 보드 승리 반응 + 승리음 |
| `scoreFx("large" \| "yacht")` | 굴림 없이 지금 위치에서 점수 기록 연출(주사위가 떠오름, 보드 족보 반응) |
| `playSound(kind)` | `throw · impact · clack · roll · land · accent · board · yacht · straight · win` 중 하나를 현재 조합의 재질·보드 표면으로 재생(라이브 믹스 경유) |
| `reset()` | 킵 해제, 첫 굴림 상태 |

### 생명주기

1. 마운트: 보드 표면이 `data-surface`로 기록되고(충돌음용), 3D 가능 시 테이블 모듈을 지연 로드. 첫 굴림 전에는 정지 주사위만 그린다(GPU 유휴).
2. `dice`·`board`가 바뀌면 `DiceArea`를 다시 만든다(이전 WebGL 컨텍스트는 `dispose` + `forceContextLoss`). 단계만 바뀌면 재질·효과만 교체.
3. 언마운트: 테이블·효과 캔버스·rAF·IntersectionObserver·텍스처·환경 맵 해제(테스트: 상세 4회 열고 닫기 후 남은 컨텍스트 ≤ 1).
4. 화면 밖·숨은 탭: 보드 장면과 발광 애니메이션 정지(기존 A1 규칙).
5. 저장·장착·서버 요청 없음. 게임 엔진·난수와 무관(미리보기 굴림은 자체 면 선택).

### 예시 — 상품 상세

```tsx
const stage = useRef<FxPreviewHandle>(null);
<FxPreview ref={stage} dice={item.id} diceLevel={level} />
<button onClick={() => stage.current?.roll()}>굴려 보기</button>
<button onClick={() => stage.current?.moment("yacht")}>요트 연출</button>
```

### 예시 — 조합 체험(주사위 × 보드 선택)

```tsx
<FxPreview dice={selectedDice} diceLevel={dLv} board={selectedBoard} boardLevel={bLv} autoRoll />
```

### 예시 — 소리만

```tsx
<FxPreview ref={stage} dice="dice.glass_blue" board="board.marble" autoRoll={false} />
stage.current?.playSound("impact"); // 유리 × 석재 충돌음
```

### 진단 속성(테스트·QA)

`.dice-table-canvas[data-material]`(재질), `[data-physical]`(고급 재질 층 사용), `[data-glow-peak]`(직전 굴림 움직임 반응 최대 배율), 바깥 `section[data-fx-preview][data-dice][data-board]`, 시너지 시 `data-synergy`(시너지 레이어가 설정).

## 3. 3D 외형과 기존 썸네일의 차이 · 정적 썸네일 제안

- 현재 카드 썸네일(`ItemViews.DiceFace` → `paintFace`)은 **2D 캔버스 한 면(5)**: 색·무늬·눈은 3D와 같지만 둥근 모서리·음각 눈·금속 반사·유리 투명·클리어코트·박막 간섭은 없다. 그래서 금·은·유리·보석·홀로그램은 카드보다 실제 3D가 훨씬 좋아 보이고, 카드에서 재질 차이가 약하다.
- 제안 A(구현됨, 선택 사용): `loadDiceThumbnail()` → `diceThumbnail(look, px)`가 **경기와 같은 재질 코드**(`die-materials.ts`)로 ¾ 시점 주사위 하나를 그려 data URL(WebP)로 돌려준다.
  - 공유 WebGL 컨텍스트 1개, 요청은 하나씩 직렬 처리, 마지막 요청 8초 뒤 컨텍스트 해제 → 경기 중에 여분 컨텍스트를 붙잡지 않는다.
  - 메모리 캐시 + sessionStorage(≈1.5 MB 상한). 같은 look·크기는 다시 그리지 않음.
  - WebGL 불가 시 `null` → 기존 2D 썸네일 유지. 권장 사용: 2D를 즉시 그리고, 카드가 화면에 들어오면(`useInView`) 3D 썸네일로 교체.
  - `{ physical: false }`로 저사양용 단순 재질.
- 제안 B(빌드 시 굽기, 미구현): `scripts/shoot-dice.mjs`와 같은 방식으로 주사위 아이템 × 단계를 PNG/WebP로 미리 렌더해 정적 자산으로 배포. 런타임 GPU 비용 0, 대신 빌드 시간·자산 용량(아이템 35 × 3단계 × 약 6 KB) 증가와 카탈로그 변경 시 재생성이 필요. 상점 첫 화면 성능이 최우선이면 B, 유지보수가 우선이면 A.

## 4. FX-1이 이미 바꾼 상점 코드(충돌 주의 범위)

| 파일 | 변경 | 비고 |
|---|---|---|
| `src/shell/ItemViews.tsx` `ItemStage` | 주사위·보드 분기를 `FxPreview`로 교체(이전: `DiceArea`+`BoardFx`+`SynergyFx` 직접 조립과 자체 굴림 상태). 사용하지 않게 된 import·`randomDice` 제거 | 버튼 라벨 "굴려 보기"·"족보 반응"·"승리 반응", `.stage-board`, `.stage-pair` 체크박스, `aria-label="미리보기 보드"`는 그대로(기존 테스트 통과) |
| 같은 곳 | 주사위 **Lv.3 탭**에 버튼 2개 추가: "요트 연출", "스트레이트 연출" | UI-2가 위치·문구·노출 조건을 자유롭게 바꿔도 됨(핸들 호출만 유지) |
| 같은 곳 | 단계 전환 시 다시 굴리는 로직이 `FxPreview.autoRoll`로 이동(이모티콘 재생 로직은 그대로) | |
| 공용 CSS(상점 전용 아님) | `items-content.css`: 보드 바탕에 `--board-grain` 층 추가(펠트·원목·가죽·대리석·금속·얼음·화산·사막), `items.css`: 2.5D 주사위 `.dice-themed[data-material]` 하이라이트, 스트레이트 줄 페이드, `responsive.css`: 요트 문구 위치 | 상점 카드의 보드 견본(`.board-sample`)도 같은 바탕을 쓰므로 카드에서도 새 재질이 보인다 |

그 밖의 상점 파일(`EconomyPages.tsx`, 카드, 필터, 상점 전용 CSS)은 수정하지 않았다. UI-2가 `ItemStage`를 다시 쓰는 경우 `FxPreview`를 그대로 가져다 쓰면 된다.

## 5. 01(경기 화면)

경기 화면은 이미 같은 `DiceArea`(3D 테이블 / 2.5D)·`BoardFx`·`SynergyFx`·`YachtFlash`·`StraightFlash`를 쓴다. FX-1의 재질·움직임 반응·소리는 이 경로 안에서 바뀌었으므로 **01의 추가 작업은 없다**. 상대 주사위는 차례인 플레이어의 외형을 같은 테이블에 그리며, "상대 아이템 효과" 끄기는 기존처럼 Lv.1로 그린다(움직임 반응·Lv.3 보조음 없음).

## 6. UI-2 #145와 대조 결과 · 최종 통합 절차 (확정, 2026-11-28)

대조 대상: #145 head의 `src/shell/shop/PreviewStage.tsx`, `src/shell/shop/preview-registry.ts`, `docs/context/UI-2-SHOP-INVENTORY.md` §6. FX-1은 #145를 병합하지 않았다(아래는 INT-1이 둘을 합칠 때의 절차).

### 6.1 인터페이스 일치

| 항목 | UI-2 `PreviewStage` | FX-1 `FxPreview` | 결과 |
|---|---|---|---|
| props | `dice·diceLevel·board·boardLevel·autoRoll·renderer·sound·className·label·onRolled·ref` | 같음 | ✅ 동일 |
| 핸들 | `roll·moment("yacht"\|"straight"\|"win")·playSound·reset·scoreFx("large"\|"yacht")` | 같음 | ✅ 동일 |
| `previewLevel(id, lv)` | 있음 | `src/fx-preview`에서 재수출 | ✅ |
| `playSound("accent" \| "board")` | `null`(미구현) | Lv.3 착지 강조(dice-fx `sound`) · 보드 반응음 | FX-1 재수출 후 동작 |
| 보드 표면 | `surfaceOf(boardId)` | 무대의 `data-surface`(같은 `surfaceOf` 값) | ✅ 같은 결과 |
| 재질 | `diceMaterial()` | 같은 함수(FX-1에서 렌더러와 같은 표로 바뀜) | ✅ |

UI-2 문서 §6의 재수출 한 줄은 FX-1 `src/fx-preview/index.ts`의 실제 내보내기와 맞다(`FxPreview`, `previewLevel`, `FxPreviewHandle`, `FxMoment`, `FxPreviewSound`, `FxPreviewProps`).

### 6.2 병합 순서 (INT-1)

1. FX-1(#146)과 UI-2(#145) 중 먼저 들어가는 쪽은 그대로. 두 번째 병합에서 충돌 파일은 `src/shell/ItemViews.tsx` 하나(UI-2 모의 병합 결과). **UI-2 쪽을 택한다** — FX-1의 ItemStage 변경(FxPreview 사용, 요트·스트레이트 버튼)은 UI-2 어댑터가 같은 핸들로 이미 포함한다.
2. `src/shell/shop/PreviewStage.tsx` 전체를 재수출 한 줄로 교체(UI-2 문서 §6-3 그대로).
3. 확인: `npx tsc -b`, `tests/ui/fx1-preview.spec.ts`(상점 상세의 `.dice-table-canvas[data-material]`, 요트·스트레이트 버튼 이름 "요트 연출"·"스트레이트 연출"에 의존 — UI-2가 버튼 이름을 바꾸면 이 스펙의 선택자만 갱신), `ui2-shop`, `economy`, `collections`.

### 6.3 정적 썸네일 캐시 (확정)

UI-2 `registerPreviewProvider({ thumbnailAsync })` 한 곳에서만 연결한다. 카드마다 WebGL을 만들지 않는다.

```ts
import { registerPreviewProvider } from "./shell/shop/preview-registry";
import { lookAt } from "./economy/live/catalog";
import { loadDiceThumbnail } from "./fx-preview";

registerPreviewProvider({
  id: "fx1-thumbs",
  categories: ["dice"],
  thumbnailAsync: async (item, level, px) => {
    const look = lookAt(item, level).dice;
    if (!look) return null;
    const render = await loadDiceThumbnail(); // three.js 지연 청크, 첫 카드가 화면에 들어올 때만
    return render(look, px);                  // 실패·WebGL 없음 → null → 2D 썸네일 유지
  },
});
```

- 캐시 키: `px | 물리층 여부 | look JSON`(look에 단계별 glow·fx·fxLevel이 들어 있어 단계가 키에 포함됨). 메모리 Map + sessionStorage(약 1.5 MB 상한, 넘으면 오래된 것부터 버림). 탭을 닫으면 사라진다(지속 캐시가 필요하면 UI-2 제안의 IndexedDB 키 = 상품 ID·단계·렌더러 버전; 렌더러 버전은 재질 코드가 바뀔 때 올린다).
- 렌더러: 공유 WebGL 컨텍스트 1개, 요청 직렬 처리, 마지막 요청 8 s 뒤 `forceContextLoss`로 해제. 썸네일 1장 ≈ 면 6장 페인팅 + 1회 그리기.
- 저사양: 썸네일은 기본 `physical: true`(한 번 그리는 정지 화면이라 경기 중 프레임 비용 없음). 기기 부담을 더 줄이려면 `render(look, px, { physical: false })`.
- 대기 중·실패 시에는 기존 2D `paintFace` 썸네일이 그대로 보인다(레이아웃 변화 없음, 같은 크기).

### 6.4 단일 활성 WebGL 무대 (확정)

- 상호작용 3D 무대는 **열린 상세(또는 인벤토리 조합) 창 하나에만** 마운트한다. 둘러보기 화면(캐러셀·레일·그리드·프리셋)에는 `FxPreview`가 없다(UI-2 테스트: `.stage-board` 0개).
- UI-2의 `claimStage()`/`isActiveStage()` 토큰을 쓰는 경우: 토큰을 잃은 무대는 `FxPreview`를 **언마운트**한다(FX-1은 언마운트 시 테이블·텍스처·환경 맵·rAF·관찰자를 모두 해제하고 `forceContextLoss` — 테스트로 남은 컨텍스트 ≤ 1 확인). 숨김만 하면 컨텍스트가 남으므로 쓰지 않는다.
- 동시에 존재할 수 있는 WebGL 컨텍스트: 상세 무대 1 + (썸네일 렌더 중일 때만) 썸네일 1. 경기 화면은 상점과 동시에 열리지 않는다.
- 재질 단계(D-138)는 세션 공용이라 상점 무대에서 느려 내려간 단계가 경기에도 이어진다(의도: 같은 기기).
