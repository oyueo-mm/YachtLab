# 병렬 개발 트랙과 코드 소유 범위 (PARALLEL-PLAN)

> 2026-11-28 기준. 담당 번호는 사용자 지시서의 "담당 NN" 표기를 따른다. 이 문서 작성자(UI-1)가 받은 지시서에서 확인되는 트랙만 범위를 적고, **지시서를 보지 못한 트랙은 "미확인"으로 남긴다**(추측해서 채우지 않음).

| 트랙 | 이름 | 소유(주로 수정) | 다른 트랙과의 경계 |
|---|---|---|---|
| 01 | 게임 UI/UX 품질 (UI-1) | 공통 점수판 `src/MultiScoreboard.tsx`·`src/ui/sheet-layout.ts`·`src/ui/scoreboard-ui1.css`, 매칭 팝업 `src/play/MatchPopup.tsx`·`src/ui/floating.ts`·`src/ui/match-popup.css`, 헤더·친구 패널 `src/shell/Chrome.tsx`·`FriendsPanel.tsx`·`header-ui1.css`·`friends-panel.css`, 공유 `src/ui/ShareResult.tsx`, 공통 규칙 `src/ui/ui1-common.css`, 리뷰 주요 장면 표시 | 주사위 렌더러(03), 매칭 정책·서버 계약(04), 상점·인벤토리 화면(02)은 수정하지 않음 |
| 02 | 상점·인벤토리 개편 | `src/shell/EconomyPages.tsx`, `ShopRail`, `ItemViews`, `shop-browse.css` 등 | UI-1 공통 디자인 규칙(토큰·모달·버튼)을 사용 |
| 03 | 주사위 렌더러·상품 이펙트·사운드 | `src/dice3d/*`, `src/Dice.tsx`, `src/play/BoardFx*`, `src/emote-fx.*`, `src/sound*` | UI-1은 배치만 바꾸고 렌더러·이펙트 내부는 건드리지 않음 |
| 04 | 서버·매칭·친구 계약 | `worker/`, `src/online/*`(프로토콜·`useBackgroundMatch`), `src/identity/friends-client.ts` | UI-1은 제공된 계약만 사용, 없는 데이터(친구 관전 등)는 표시하지 않음 |
| 05~08 | 미확인 | — | 지시서를 받은 담당자가 이 표를 갱신한다 |

## 충돌 관리 규칙
- 공용 파일은 줄 단위 최소 수정, 새 기능은 새 파일 우선(A4 방식).
- 문서 변경은 제품 코드와 별도 커밋.
- 결정 번호는 병합 시 재부여할 수 있다(D-099 선례).
