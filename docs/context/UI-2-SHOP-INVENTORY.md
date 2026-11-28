# UI-2 — 상점·뽑기·인벤토리 전면 개편 (2026-11-28, 담당 02)

브랜치 `claude/epic-maxwell-gqy1v5`. 상점은 "발견하고 체험하고 갖고 싶게", 인벤토리는 "내 게임 환경을 꾸미고 관리하는 곳"으로 나눴다. **상품 ID·가격·획득 조건·등급·뽑기 확률·재화 소모·중복 보상·강화 단계·보유권은 바꾸지 않았다**(단위 테스트가 카탈로그 불변을 확인). 새 상품·컬렉션·판매 정책·할인은 없다.

스크린샷: [수정 전](../ui/ui-2-shop/before/) · [수정 후](../ui/ui-2-shop/after/) (데스크톱 1440×1000, 모바일 Pixel 7; `UI2_SHOTS=after npx playwright test tests/ui/ui2-shop-shots.spec.ts`로 재생성).

## 1. 무엇이 바뀌었나

| 영역 | 수정 전 | 수정 후 |
| --- | --- | --- |
| 페이지 폭 | 본문 최대 860~1080px, PC 양옆이 비어 있음 | 상점·뽑기·인벤토리만 최대 1600px(App `main.page-shop/draw/inventory` 1680px) |
| 상점 상단 | 없음 | 프로모션 캐러셀: 에디터 추천 + 기존 테마 컬렉션 10종(번개·초원·꽃밭·벚꽃·숲·심해·용암·얼음·우주·오로라). 6.5초 자동 넘김, 호버·키보드 포커스·탭 숨김·명시적 일시정지·`prefers-reduced-motion`에서 정지, 좌우 화살표·점·←/→ 키·모바일 스와이프, 컬렉션 필터·상품 상세로 바로 이동 |
| 카테고리 | 가로 칩 줄(기본 스크롤바 노출) | PC 좌측 고정 사이드바(세로 탭, ↑/↓), 모바일·태블릿은 상단 고정 칩 줄(스크롤바 숨김, 끝 페이드, 스냅) |
| 둘러보기 / 전체 | 한 화면에 섞임 | 둘러보기 = 캐러셀 + 에디터 추천 + 테마 컬렉션 + 신상품 + 카테고리별 가로 레일. 카테고리 선택·검색·필터 시 = 반응형 세로 그리드(결과 수·정렬 표시) |
| 가로 레일 | 기본 스크롤바, 카드가 잘림 | 스크롤바 숨김 + 스크롤 스냅 + 좌우 버튼 + 휠/드래그(기존) |
| 검색·필터·정렬 | 등급·가격(재화)·테마 | + 이름·테마 검색, 가격대(코인 4구간), 보유 상태(회원), 정렬 7종(추천·신상품·등급↑↓·가격↑↓·이름), 필터 초기화 |
| 카드 | 썸네일 84px + 6줄 정보 | 4:3 이미지 영역(등급 색 배경) + 이름·등급·Lv 범위·가격/보유·장착 배지만 |
| 상세 | 세로 1열 | PC 2열(라이브 미리보기 / 보유·장착 상태·컬렉션·Lv.1~3 비교·행동), 보유 상품은 상점에서 바로 장착, 인벤토리로 이동해 강화 |
| 미리보기 | 굴리기, 컬렉션 조합 | + 내 장착 보드/주사위와 조합, 소재 효과음 듣기, 이모티콘 Lv.1→3 효과음 연속 비교, 기본 연출 미리보기 |
| 뽑기 | 상점 탭 안 단순 목록 | 독립 2열 화면: 왼쪽 주사위·버튼·결과, 오른쪽 비용·하루 횟수·중복 보상 요약과 등급별 확률 막대(7,776조합 계산값), 상세 확률표·기록. 결과 공개 애니메이션(등급 테두리), "새 상품 획득"/"이미 보유 · 25코인으로 지급" 구분, 연출 건너뛰기(버튼·보드 탭) |
| 인벤토리 | 미리보기 1줄 + 탭 + 목록 | 장착 미리보기(보드 위 주사위·플레이어 태그·말풍선·이모티콘) + 9개 슬롯 요약(클릭 시 해당 상품군으로 이동, 저장 전 변경 점선 표시) + "이 조합으로 굴려 보기" + 저장/변경 취소, 검색·보기(장착 중/미장착/강화 가능)·정렬, 카드에서 바로 강화, 장착 프리셋, 컬렉션 진행도 |
| **특수 연출 탭 오류** | 인벤토리에서 특수 연출 탭을 누르면 **앱 전체가 흰 화면**(기본 연출 `fx.none`의 썸네일이 없는 `look.fx`를 읽다 예외) | 기본 연출 썸네일·미리보기를 따로 그림. [수정 전 화면](../ui/ui-2-shop/before/desktop-inventory-fx.png) |

## 2. 원칙

- **편집 큐레이션만.** 이용량을 수집하지 않으므로 인기 순위·개인화 추천이 없다. "추천순"은 `src/shell/shop/curation.ts`의 `EDITOR_PICKS` 순서이고 화면에 "이용량이나 개인 데이터 없이 직접 고른 편집 목록"이라고 적는다. 신상품 = 가장 최근 카탈로그 리비전(현재 rev 2, 2026-11-27 컬렉션 11종).
- **출시되지 않은 것을 홍보하지 않음.** 캐러셀은 판매 중이 아닌 시즌(크리스마스) 상품을 넣지 않는다. 서버가 아직 팔지 않는 rev 상품만 있는 슬라이드는 "판매 준비 중"을 표시한다. 문구에 할인·묶음·마감 표현이 없음을 테스트한다.
- **렌더러는 한 번에 하나.** 카드·캐러셀·슬롯 요약·프리셋은 정적 썸네일(2D 캔버스 한 면 또는 CSS 샘플, 화면 밖이면 그리지 않음)만 쓴다. 3D/WebGL 무대는 열린 상세 창 또는 조합 미리보기 창 하나에만 있고 닫으면 언마운트된다(`claimStage` 토큰).
- **관측 경계.** 미리보기는 게임 RNG·서버 상태를 읽지 않으며 아무것도 저장하지 않는다(테스트에서 요청 0건 확인).

## 3. 장착 프리셋 — 기기 저장, 서버 계약

현재 프리셋은 **이 브라우저에만** 계정 ID별(`yachtlab.loadout-presets.v1:<accountId>`, 세션 비밀값 미포함)로 최대 5개 저장한다. **계정 동기화는 없고** 화면에 "이 기기에만 저장 · 계정 동기화 없음"이라고 쓴다. 불러오기는 서버와 같은 `validateLoadout`(소유·상품군·슬롯 수·해금 단계)을 통과해야 그대로 적용되고, 실패하면 `sanitizeLoadout`으로 기본값 대체 후 이유를 알린다. 어느 경우든 초안일 뿐이며 "장착 저장" 때 서버가 다시 검증한다. 계정 전환 시 `ItemsPage`가 세션 키로 다시 마운트되어 다른 계정의 프리셋이 보이지 않는다.

서버 동기화 계약(미구현, Worker 담당 검토 필요):

```
GET  /api/me/loadout-presets        → { presets: { id, name, loadout, at }[] }   (최대 5)
PUT  /api/me/loadout-presets        ← { presets: [...], requestId }  → 같은 형태
POST /api/me/loadout-presets/apply  ← { id, requestId } → Snapshot  (서버가 validateLoadout 후 loadout 저장)
```

- 이름 1~20자, 서버가 `validateLoadout`의 형태 검사만 저장 시 수행하고 소유 검사는 적용 시 수행(보유가 바뀌어도 프리셋은 남김).
- 이관: 첫 동기화 때 로컬 프리셋을 서버에 올릴지 사용자에게 묻고, 성공하면 로컬 키를 지운다.

## 4. 연동 사항

### 담당 01 (글로벌 헤더·App·공통 모달)
- App/헤더/공통 모달 파일은 수정하지 않았다. 상점 전용 `src/shell/shop/shop.css`가 `.main.page-shop, .main.page-draw, .main.page-inventory`의 `max-width`를 1680px로 넓힌다. 01이 App 본문 폭 체계를 바꾸면 이 규칙을 그쪽 토큰으로 옮겨 달라.
- 모바일 상단 카테고리 칩은 `position: sticky; top: 56px`(현재 헤더 높이)을 쓴다. 헤더 높이가 바뀌면 CSS 변수로 공유하자(`--header-h` 제안).
- 상세 창은 기존 `.modal` + `useActivityDialog`를 그대로 쓰고 너비만 `.item-detail-v2`로 980px까지 넓혔다.

### 담당 03 (렌더링·사운드) — FX-1 `FxPreview`와의 연동은 §6
- 기본 연결: 주사위·보드 상세 무대는 `src/shell/shop/PreviewStage.tsx`(FxPreview와 같은 props·핸들)를 통해서만 쓴다.
- 확장 연결점: `src/shell/shop/preview-registry.ts`의 `registerPreviewProvider({ id, categories, Stage?, thumbnail?, sound? })`.
  - `Stage(props: { item, level, partner, active })`: 주사위·보드 상세 무대를 대체. `active=false`면 렌더 루프 정지.
  - `thumbnail(item, level) → url | null`: 카드용 사전 렌더 이미지(아틀라스 등). null이면 기존 캔버스 썸네일.
  - `sound(item, level, cue)`: "소리 듣기/효과음 비교" 버튼용 큐(`roll|land|emote|fx|tap`). 현재는 내장 합성음 사용.
- 단일 활성 무대 규칙(`claimStage`/`isActiveStage`)을 지켜 달라. 카드마다 WebGL 컨텍스트를 만들지 않는다.

### 담당 07 (QA/릴리스로 이해함 — 범위 확인 필요)
- 회귀 범위: `tests/ui/economy.spec.ts`, `collections.spec.ts`, `onboarding-shop.spec.ts`, 신규 `tests/ui/ui2-shop.spec.ts`, 단위 `tests/shop-curation.test.ts`.
- 수동 확인 권장: 실제 Worker(rev 2)에서 캐러셀의 "판매 준비 중" 표시가 사라지는지, 프리셋 불러오기 후 저장이 서버 검증을 통과하는지.

## 5. 검증 (2026-11-28, 로컬 컨테이너, Chromium · desktop 1440×1000 + Pixel 7)

| 범위 | 결과 |
| --- | --- |
| 단위 `tests/shop-curation.test.ts` (큐레이션·필터·정렬·카탈로그 불변·프리셋 검증·계정 분리·단일 무대 토큰) | 8/8 통과 |
| UI `tests/ui/ui2-shop.spec.ts` (캐러셀, 둘러보기/전체 분리, 검색·가격대·정렬, 9개 상품군, 보유·장착 상태, 요트·스트레이트 연출, 특수 연출 탭, 목록 강화, 컬렉션 진행도, 프리셋 검증·계정 분리, 뽑기 공개·중복, 320~1920px 6개 폭 × 3화면 가로 넘침 없음) | 14/14 통과(두 기기) |
| 기존 UI `economy`·`collections`·`onboarding-shop`·`a1-board-fx`·`a2-cosmetics` | 전부 통과(조건부 skip 3 기존) |
| FX-1 병합 모의(§6) | 충돌 1파일, 해결 후 tsc·FX-1 `fx1-preview`·UI-2·economy·collections 52 통과 |
| 전체 `npm test`·`npm run build`·전체 Playwright | 결과는 PR 본문과 [RESULTS.md](./RESULTS.md) |

발견·수정한 기존 문제: ① 인벤토리 특수 연출 탭 흰 화면(위 표). ② 첫 방문 인벤토리 안내가 열린 상세 창 위에 겹쳐 뜨면서 Esc를 가로채 창이 닫히지 않던 경쟁 상태 — 안내는 열린 모달이 없을 때까지 기다린다(`src/ui/Coach.tsx`), 회귀 테스트 방문자 상태에 인벤토리 안내 확인을 추가.

한계: 실제 Worker·실계정 구매/강화/장착은 로컬 모의 서버로만 확인했다. 성능은 구조(카드 WebGL 0개, 상세 무대 1개, 화면 밖 썸네일 미렌더)로 보장하며 FPS·메모리 실측은 하지 않았다.

## 6. FX-1 `FxPreview` 연동 계획 (브랜치 `claude/epic-cannon-2h7dfr`, 병합하지 않음)

FX-1은 `src/fx-preview`의 `FxPreview`/`FxPreviewHandle`(D-104)을 제공하고, 같은 브랜치에서 `ItemStage`의 주사위·보드 분기를 `FxPreview`로 바꾸고 주사위 Lv.3 상세에 "요트 연출"·"스트레이트 연출"을 추가했다. UI-2는 FX-1을 병합하지 않고 다음처럼 설계했다.

1. **같은 인터페이스의 어댑터.** `src/shell/shop/PreviewStage.tsx`는 `FxPreview`와 같은 props(`dice`, `diceLevel`, `board`, `boardLevel`, `autoRoll`, `renderer`, `sound`, `label`, `onRolled`, `ref`)와 같은 핸들(`roll`, `moment("yacht"|"straight"|"win")`, `scoreFx`, `playSound`, `reset`)을 가진다. 지금은 main의 경기 구성 요소(DiceArea·BoardFx·SynergyFx·score-fx)로 구현돼 있다. 상점·인벤토리 코드는 이 어댑터만 부른다.
2. **ItemStage는 이미 FX-1 형태.** 주사위·보드 분기는 FX-1과 똑같이 `ref` 핸들로 굴림·족보 반응·승리 반응을 부르고, FX-1이 추가한 요트·스트레이트 연출을 모든 단계의 주사위·보드에서 쓸 수 있게 넓혔다(연출 칩 그룹). 여기에 UI-2의 내 장착 보드/주사위 조합, "소리 듣기"(`playSound("impact")`→`"land"`), 기본 연출(fx.none) 미리보기, 단일 활성 무대 토큰이 더해진다.
3. **병합 절차(FX-1 → main 이후 UI-2 갱신 시).**
   - 충돌 파일은 `src/shell/ItemViews.tsx` 하나다(모의 병합으로 확인). UI-2 쪽(`ours`)을 택한다. FX-1의 ItemStage 변경 — `FxPreview` 사용, 직접 DiceArea·BoardFx 코드 제거, 요트·스트레이트 버튼, import 정리 — 는 어댑터를 통해 모두 유지된다. FX-1의 `face-paint.ts`·`table.ts`·`sound.ts` 등 다른 변경은 충돌 없이 그대로 들어온다.
   - `src/shell/shop/PreviewStage.tsx` 전체를 한 줄 재수출로 바꾼다:
     `export { FxPreview as PreviewStage, previewLevel, type FxPreviewHandle as PreviewStageHandle, type FxMoment as PreviewMoment, type FxPreviewSound as PreviewSound, type FxPreviewProps as PreviewStageProps } from "../../fx-preview";`
   - 그러면 `playSound("accent")`(Lv.3 착지 강조)·`"board"`·재질별 소리·`soundEnabled`가 FX-1 구현으로 살아난다.
   - 모의 병합(위 두 단계 적용)에서 `tsc -b` 통과, `tests/ui/fx1-preview.spec.ts`·`ui2-shop`·`economy`·`collections` 52개 통과(FX-1 자체의 모바일 skip 2).
4. **카드 썸네일.** 카드는 3D 테이블과 같은 면 페인터(`paintFace`)로 그린 2D 캔버스 한 장이라 색·무늬·눈 배치·Lv.2/3 발광은 실제와 같다. FX-1의 PBR(범프·거칠기·금속·투명·자체 발광 맵)과 둥근 모서리는 2D 썸네일에 없다. 다음 단계: FX-1 병합 뒤 `registerPreviewProvider({ id: "fx1-thumbs", categories: ["dice"], thumbnail })`로 **단일 오프스크린 WebGL 렌더러 하나**가 대기열에서 상품별·단계별 정지 이미지를 차례로 렌더해 메모리(+선택적으로 IndexedDB, 키 = 상품 ID·단계·렌더러 버전)에 캐시하고, 준비 전에는 지금의 2D 썸네일을 보인다. 카드마다 WebGL 컨텍스트를 만들지 않는다는 원칙은 그대로다. 이 렌더러 API는 03(FX-1)의 `table.ts`/`stage.ts`에 정지 프레임 렌더 함수가 필요하므로 FX-1 담당에게 요청한다.
5. **단일 렌더러.** `FxPreview`는 열린 상세 창(또는 인벤토리 "이 조합으로 굴려 보기" 창) 하나에서만 마운트된다. 캐러셀·레일·그리드·슬롯 요약·프리셋에는 WebGL이 없다(UI 테스트: 둘러보기 화면 `.stage-board` 0개, 상세 1개).
