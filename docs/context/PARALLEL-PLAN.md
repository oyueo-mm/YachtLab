# 병렬 개발 트랙과 코드 소유 범위 (PARALLEL-PLAN)

> 2026-11-28 확정 트랙(사용자 지시). 앞으로 문서·커밋·PR에서는 담당 번호 대신 **작업 ID**를 쓴다.
> 결정 번호(D-xxx)는 통합 담당(INT-1)이 병합 시 확정한다. 각 트랙은 PR에서 임시 ID(예: `D-129`)를 쓴다.
> "주로 수정" 열은 현재 저장소 구조에서 확인한 경로이며, 경계가 겹치면 공용 파일은 줄 단위 최소 수정(새 파일 우선)으로 처리한다.

| 작업 ID | 범위 | 주로 수정 | UI-1과의 경계 |
|---|---|---|---|
| **INT-1** | 제품 통합, CI/CD, 운영 배포 | `.github/workflows/*`, `docs/operations/*`, 통합 PR, 결정 번호 확정 | UI-1은 PR까지. main 병합·Pages/Worker 배포는 INT-1 + 별도 승인 |
| **UI-1** | 게임 및 공통 UI/UX | 공통 점수판(`src/MultiScoreboard.tsx`, `src/ui/sheet-layout.ts`, `src/ui/scoreboard-ui1.css`), 매칭 팝업(`src/play/MatchPopup.tsx`, `src/ui/floating.ts`), 헤더·친구 패널(`src/shell/Chrome.tsx`, `FriendsPanel.tsx`), 결과창 표시(`src/match-result/*` 표시 부분), 공유(`src/ui/ShareResult.tsx`), 리뷰 표시, 단축키(`src/ui/shortcuts.tsx`), 공통 규칙(`src/ui/ui1-common.css`) | — |
| **UI-2** | 상점 및 인벤토리 | `src/shell/EconomyPages.tsx`, `ShopRail.tsx`, `ItemViews.tsx`, `DrawPanel.tsx`, `shop-browse.css` | UI-1 공통 토큰·`Sheet` 모달 규칙 사용, 헤더 상점/인벤토리 버튼은 UI-1 |
| **FX-1** | 주사위·보드 연출 및 사운드 | `src/dice3d/*`, `src/Dice.tsx`, `src/play/BoardFx*`, `src/emote-fx.*`, `src/sound*`, `src/audio/*` | UI-1은 배치·크기만, 렌더러·이펙트·소리 내부는 FX-1 |
| **SOC-1** | 온라인, 친구, 매칭, 관전 | `worker/`, `src/online/*`(프로토콜, `useBackgroundMatch`), `src/identity/friends-client.ts`, `src/social/*` 데이터 | UI-1은 계약만 사용, 없는 데이터는 표시하지 않음 → [§SOC-1 연동 요구사항](./UI-1-GAME-UX-2026-11-28.md#10-soc-1-연동-요구사항) |
| **LIVE-1** | 오늘의 요트, 전략 퍼즐, 일일·친구 랭킹 | 신규 화면(예정) | 점수판·결과창·모달은 UI-1 공통 컴포넌트 재사용 권장 |
| **ADMIN-1 / FEEDBACK-1** | 관리자 인증, 통계, 보상 관리, 공지, 신고, 제재, 이의제기, 사용자 건의 | 관리자 화면·API(예정) | 헤더 `.header-badge`를 공지·보상함 알림에 재사용 가능 |
| **C5** | 경제 연구, 가격 시뮬레이션, 출석, 일일 경기 보상, 연속 활동, 보상함, 교환 코드, 공통 경제 원장 | `src/economy/*`, 경제 Worker | 결과창 보상은 서버 receipt만 표시(UI-1 표시 규칙 불변) |
| **SEC-1** | 독립 사이버 보안 감사, 보안 수정, 신규 기능 통합 감사 | 감사 문서(민감 상세는 비공개, D-098), 보안 수정 | UI-1 변경(포털 팝업·친구 패널)은 SEC-1 통합 감사 대상 |
| **LANG-1** | 한국어·일본어 현지화 (후속) | 문자열 추출·i18n | **공통 UI 안정화(UI-1) 이후** 시작. UI-1은 새 문자열을 컴포넌트 안 한 곳에 두어 추출을 쉽게 함 |

## 이전 표기와의 대응
UI-1 첫 커밋 문서의 "담당 01~04"는 각각 UI-1·UI-2·FX-1·SOC-1이다. "05~08 미확인"은 위 표로 해소했다.

## 충돌 관리 규칙
- 공용 파일은 줄 단위 최소 수정, 새 기능은 새 파일 우선(A4 방식).
- 문서 변경은 제품 코드와 별도 커밋.
- 결정은 트랙 임시 ID로 기록하고 INT-1이 통합 시 D-번호를 부여한다(SEC-1 PR #137이 D-101을 사용 중).
- 다른 트랙의 브랜치는 수정하지 않는다.
