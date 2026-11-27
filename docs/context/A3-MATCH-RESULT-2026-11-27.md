# A3 — 경기 종료 화면·0점 기록 연출·재대결 전적 조사 (2026-11-27)

> 상태 (2단계, 2026-11-27): **1인·사람 vs AI·로컬 다인전에 실제 연결 완료.** 온라인 1:1·다인전·관전은 C3 병합 후. 재대결 전적 문제는 격리 Worker로 **재현 완료**, 수정 훅 작성·브라우저 검증, 공용 파일 연결은 C3와 조율 대기. 브랜치 `claude/a3-match-result`([PR #120](https://github.com/oyueo-mm/YachtLab/pull/120)). 운영 배포·병합 없음(승인 대기).
> 기준 main: 1단계 `0462030` → 2단계 `31dbc50`(A2.1 #117, Hotfix #119 포함). 요구사항 출처: 사용자 지시(2026-11-27 A3) 및 `handoff/next-development-20261127`의 NEXT-DEVELOPMENT §2.D.

## 1. 사용자 피드백과 설계 방향

- 친구와 몇 시간씩 연속 대전, 극적인 역전승에서 큰 재미, 디스코드 음성채팅과 함께 플레이.
- 따라서 결과 화면은 **빠른 재대결**이 첫 버튼, 역전·접전은 **실제 기록으로 근거가 있을 때만** 크게, 소리는 음성채팅을 방해하지 않도록 **짧은 강조음만** 덧붙인다(승패 기본음은 게임이 이미 재생).
- 자체 음성채팅은 만들지 않는다.

## 2. 구현 범위 (모두 신규 파일)

| 파일 | 내용 |
| --- | --- |
| `src/match-result/model.ts` | 결과 분류, 채점 순서 재구성(timeline), 역전 기준, 하이라이트, 경기 시간, 보상 표시 모델 (순수 함수) |
| `src/match-result/MatchResultPanel.tsx` | 결과 창: 닫기·다시 열기, 순위·프로필·점수 카운트업, 하이라이트, 보상, 재대결/리뷰/친구 추가/공유/홈 |
| `src/match-result/match-result-a3.css` | `a3-` 접두사 스타일, 모바일(≤420px)·동작 줄이기 대응 |
| `src/match-result/result-sfx.ts` | 결과 강조음 계획(기존 `playSfx`만 조합 → 음소거·효과음·음량·버스 믹스 그대로 준수) |
| `src/match-result/useRewardState.ts` | 서버 receipt 조회 → `pending / delayed / failed / settled / none` (조회 전용, 지급 요청 없음) |
| `src/match-result/zero-score.ts`, `ZeroScoreToast.tsx` | 0점 확정 기록 감지·문구·팝업 |
| `src/match-result/adapters.ts` | 온라인 이벤트 로그·오프라인 카드 기록 → 결과 입력 (공개 관측만) |
| `src/match-result/fixtures.ts`, `preview.tsx`, `/match-result-preview.html` | 개발용 미리보기와 예시 데이터(실제 기록 아님). 운영 빌드 입력에 포함되지 않음 |
| `tests/match-result-a3.test.ts` | 단위 테스트 36개 |
| `tests/ui-preview/*.spec.ts`, `playwright.preview.config.ts` | 미리보기 브라우저 테스트 6개 × desktop / Pixel 7 / 320px |
| `.github/workflows/a3-match-result-preview.yml` | `src/match-result/**` 변경 PR에서 위 테스트 실행 |

변경하지 않은 공용 파일: `src/ui/MatchResult.tsx`(C3가 수정 중), 게임 화면(`HumanGame`·`OnlineGame`·`OnlineMulti`·`SoloGame`·`LocalGame` — A2.1·C3), `App.tsx`, `shell/MatchRewards.tsx`, `profile-economy.ts`, `sound.ts`, `settings.ts`, `routes.ts`, `lab/*`, 경제 설정·카탈로그·Worker.

## 3. 결과 구분

| 구분 | 조건 | 제목 |
| --- | --- | --- |
| 승리 / 패배 / 무승부 | 2인, 엔진 `winners` | 승리 · 패배 · 무승부 |
| 기권승 | 2인, 상대 `playerForfeited` | 승리 + "OO 님이 경기를 떠났어요" 등 사유 (역전·접전 연출 없음) |
| 기권패 | 2인, 내가 기권/시간 초과/이탈 | 기권패 |
| 다인전 | 3명 이상, 점수 순위(기권자는 아래) | 1위 · 공동 2위 · n위 + "n명 중" |
| 1인 | 좌석 1개 | 최고 기록 갱신! · 첫 기록 완성 · 경기 종료 (최고 기록은 출처를 받은 경우만) |
| 관찰자 | `you` 좌석 없음(로컬 2인) | "OO 승리" |

## 4. 역전승·접전 판정 기준 (D-A3-1)

입력은 **실제 채점 순서**(온라인 `categoryScored` 이벤트, 오프라인 기보 프레임의 카드 변화)다. 이를 처음부터 다시 쌓아 **최종 카드와 모든 칸이 일치할 때만** 판정한다. 기록이 없거나 일치하지 않으면 역전 연출을 하지 않는다(접전만 최종 점수로 판정).

- 라운드 종료 지점 r(1~11): 기권하지 않은 모든 좌석의 기록 칸 수가 r로 같아진 순간. 점수에는 그 순간 달성한 상단 보너스(+35)를 포함한다.
- 열세 d(r) = (나를 뺀 최고 점수) − (내 점수).
- **단독 승리**(2인 승리 또는 다인전 단독 1위)에만 아래를 붙인다. 기권승·공동 1위·무승부에는 없음.

| 등급 | 조건 | 강조음(기존 효과음 조합) |
| --- | --- | --- |
| 대역전승 | d(r) ≥ 30 at r ≥ 9, 또는 d(r) ≥ 50 at r ≥ 6 | fxFanfare + fxCoin |
| 역전승 | d(r) ≥ 20 at r ≥ 6 | fxFanfare(약하게) |
| 마지막 차례 역전 | 내 마지막 채점 직전 1위보다 뒤져 있었음 | fxBell + fxSparkle |
| 접전 승리 | 최종 점수 차 1~10점 | fxBell(약하게) |

수치는 `COMEBACK` 상수(`model.ts`)와 테스트가 공유한다. 기존 `behindAfterNine`(9라운드 후 30점 이상, `src/ui/GameMoments.tsx`)은 "대역전승"의 늦은 조건과 같으므로 통합 때 이 모델로 대체한다. 수치는 사용자 경험 기준의 제안값이며 실제 경기 분포로 검증한 값이 아니다(§9).

## 5. 하이라이트·기록·보상 표시 규칙

- 요트: 내 카드 `yacht === 50`. 라지 스트레이트: `large === 30`. 상단 보너스: 상단 ≥ 63. 0점 기록은 하이라이트가 아니다. 채점 순서가 유효하면 "n번째 기록"을 덧붙인다.
- 개인 최고 기록/첫 기록: 호출한 쪽이 이번 경기 **이전** 최고점과 출처(`계정`/`이 기기`)를 줄 때만.
- 연승: 서버가 확인한 빠른 대전 연승이 2 이상이고 이번 경기를 이겼을 때만(STREAK-REVIEW 기준 유지).
- 경기 시간: `matchStarted`~`matchFinished`(온라인) 또는 시작·종료 시각. 0 이하·6시간 초과는 표시하지 않음.
- 보상: **서버 receipt가 있을 때만 금액 표시**(after − before). 퀘스트는 receipt의 `done` 중 이번 경기에서 완료된 것만 "완료", 나머지는 진행 막대. 업적·퀘스트 묶음은 receipt `grants`.
  - 조회 중 → "보상을 확인하는 중이에요…", 404 재시도(0.75/1.5/2.25 s) 뒤에도 없음 → "정산이 늦어지고 있어요", 기타 오류 → "불러오지 못했어요"(지급 여부는 내역에서 확인). 어떤 경우도 지급 완료처럼 표시하지 않는다.
  - AI·로컬·1인처럼 보상이 없는 모드는 보상 칸을 숨긴다. 게스트는 로그인 안내 한 줄.
- 경기 결과에 판단 정확도·운·실수·자동 분석을 넣지 않는다(테스트로 금지 단어 검사). "게임 리뷰"는 버튼만.

## 6. 0점 기록 연출 (D-A3-2)

- 팝업: 보드 위 1.6초, 차분한 회색, 입력을 막지 않음(`pointer-events: none`), `role=status`·`aria-live=polite`. 동작 줄이기에서는 움직임 없이 표시.
- 문구: "요트 0점 기록" + 사실 한 줄("남은 칸 n개", 상단 칸이고 보너스가 아직 가능하면 "상단 보너스까지 n점"). 실패·비난·아쉬움 표현 없음.
- 효과음: 기존 `scoreZero`(game-feel.ts가 채점 순간 이미 재생). 통합 시 팝업은 **소리를 추가하지 않는다**(`sound=false` 기본). 미리보기만 같은 소리를 들려준다.
- A2.1이 상단 보너스·특수 효과(`bonus-moment`, `Scoreboard`, 게임 화면)를 수정 중이므로 연결하지 않았다. A2.1 병합 후 `useGameSounds`와 같은 카드 변화 지점에서 `zeroScored(before, after)`로 연결한다(사람·AI 동일 취급, 재접속 동기화는 무시).

## 7. 재대결 후 전적이 바로 반영되지 않는 문제 — 읽기 전용 조사

**확인한 사실 (코드 기준)**

1. 서버는 재대결마다 새 `matchId`로 경기를 만들고(`src/online/room.ts` `newMatchId`), 계정 기록 `recordId = matchId`라 중복 제거에 걸리지 않는다. 종료 이벤트와 같은 저장에서 outbox에 넣고 메시지 처리 직후 `flushRecords()`로 계정에 전달한다(`worker/src/host.ts`). → **서버 저장 자체는 재대결과 무관하게 즉시 이루어지는 구조.**
2. 방 안의 "이 방 전적"은 종료 시 `broadcastRematch`로 갱신된다(정상).
3. 기기 기록(`saveLocalRecord`)은 `yachtlab-records` 이벤트를 보내지만, **로그인 상태의 프로필·전적 화면은 서버 기록(`remote`)을 우선**하고 이 이벤트로 서버 기록을 다시 불러오지 않는다(`src/shell/Profile.tsx` 서버 조회는 마운트·로그인 변화 때만, `src/shell/MatchHistory.tsx` 동일).
4. 상단 바·사이드바의 재화·퀘스트·연승(`useProfileEconomy`, `src/shell/profile-economy.ts`)은 **`atHome`이 바뀔 때만 다시 조회**한다(`src/App.tsx`의 `useProfileEconomy(onlineServer, page === "home")`). 방에 머물며 재대결을 이어 가면 홈으로 나가거나 새로고침하기 전까지 갱신되지 않는다. 결과 창의 `matchReward` 조회는 `yachtlab-economy` 이벤트를 보내지 않는다.
5. 홈 보상 알림(`pendingReward`)은 **한 칸짜리 상태**라 재대결로 여러 경기를 끝내면 마지막 경기만 남는다(`src/App.tsx` `setPendingReward`). 앞 경기의 퀘스트·업적 알림은 홈에서 보이지 않는다(지급 자체는 원장에 있음).

**추정 원인**: 사용자가 본 "승리 전적"이 상단·프로필의 계정 집계(3·4)라면, 클라이언트가 경기 종료 후 계정 상태를 다시 조회하지 않는 것이 원인이다. 실제 Worker로 재현하지 않았으므로 어느 화면을 본 것인지는 **미확인**이다.

**실제 재현 (2단계, `tests/ui/a3-rematch-records.spec.ts`)** — 로컬 Worker(`wrangler dev --local`, `ECONOMY=on`), 가짜 로그인 회원 2명, 같은 친구 방에서 재대결로 2경기 연속.

| 시점 | 서버(API) | 방 안 화면 |
| --- | --- | --- |
| 1경기 종료 | 계정 기록 ≤ 22 ms 안에 존재, receipt +15~30코인, 지갑 215 | 결과 창 `+15코인` 정상 · **상단 재화 200(경기 전 값)** |
| 2경기 종료 | 기록 2개, 지갑 230~245 | 결과 창 정상 · 이 방 전적 정상 · **상단 재화 여전히 200** |
| 앱 안에서 홈으로 | — | 상단 재화 서버 값으로 갱신 · 홈 보상 알림은 **마지막 경기 1건 이하**(1경기의 주간 퀘스트 진행 `w.days4`는 어디에도 표시 안 됨) |
| 프로필로 이동 | — | 서버 기록 2경기 표시(새로 마운트되어 정상) |

- **결론: 서버 저장 지연이 아니라 클라이언트 갱신 누락.** 서버는 종료 직후(수십 ms) 기록·receipt·원장을 모두 반영한다. 방 안의 재화·퀘스트·연승 표시(`useProfileEconomy`)는 홈 진입 때만 다시 읽고, GET `economy()`는 `yachtlab-economy` 이벤트를 보내지 않는다(POST만).
- 결과 창은 receipt를 읽어 이번 경기 보상을 정확히 보여 주고, receipt 전에는 금액을 만들지 않는다(정상).
- 사용자가 말한 "승리 전적"이 프로필 화면이라면 이동 시 새로 읽으므로 정상이다. 방 안에서 계속 보이는 계정 값은 상단 재화·사이드바 퀘스트뿐이다. 다른 기기·탭에 열어 둔 프로필(마운트 유지)은 갱신되지 않는다(H-A3-2).

**수정안 (작성·검증 완료, 공용 파일 연결은 대기)**

- H-A3-1 `src/match-result/account-refresh.ts` `useAccountRefreshAfterMatch(server, matchId, finished)`: receipt가 확정된 뒤(404 재시도, 지연·실패면 아무것도 바꾸지 않음) `economy()`를 다시 읽고, 기존 `yachtlab-economy` 이벤트 형식으로 알린다 → **App.tsx·profile-economy.ts 변경 없이** 상단 바·사이드바 갱신. 같은 matchId는 한 번만, 계정이 바뀌면 알리지 않음. 연결은 `OnlineGame`·`OnlineMulti`에 한 줄. 임시로 `OnlineGame`에 연결해 `A3_HOTFIX=1`로 같은 재현을 돌린 결과 방 안 상단 재화가 **215 → 230으로 서버와 일치**(커밋하지 않음, C3가 OnlineGame을 수정 중).
- H-A3-2 `Profile.tsx`·`MatchHistory.tsx`: 로그인 상태에서도 `yachtlab-records` 수신 시 `serverRecords` 재조회(위 훅이 이 이벤트를 보냄).
- H-A3-3 `App.tsx`: `pendingReward`를 matchId 목록으로 바꾸고 홈 알림에서 여러 경기의 퀘스트·업적을 합쳐 표시(결과 창에서 이미 본 코인은 제외하는 현재 규칙 유지).

**Hotfix 후보 (공용 파일 — 이 PR에서 수정하지 않음, C3·Hotfix 담당과 순서 조율)**

- H-A3-1 `profile-economy.ts`: 경기 종료 이벤트(예: `yachtlab-match-finished` 또는 `onFinished`)에서 `economy(server)`를 다시 조회. 결과 receipt 확정 후 1회.
- H-A3-2 `Profile.tsx`·`MatchHistory.tsx`: 같은 이벤트에서 `serverRecords` 재조회(또는 `yachtlab-records` 수신 시 로그인 상태면 서버 재조회).
- H-A3-3 `App.tsx`: `pendingReward`를 matchId 목록(최근 n개)으로 바꾸거나 홈 알림이 여러 경기를 합쳐 보여 주도록.
- 회귀 테스트: 같은 방에서 2경기 연속 종료 → 홈으로 나가지 않고 상단 재화·프로필 전적이 2경기를 반영하는 Playwright(온라인 테스트 Worker).
- C3가 도입하는 `ActivityVisible`(화면을 숨긴 채 유지)과 결합하면 3·4의 "마운트 시에만 조회" 문제가 더 자주 드러날 수 있으므로 C3 병합 후 함께 검증한다.

## 8. 통합

**완료 (2단계, C3와 충돌 없음 — `origin/codex/c3-background-matchmaking` 시험 병합으로 확인)**

| 모드 | 파일 | 결과 입력 | 0점 팝업 | 승리 효과 |
| --- | --- | --- | --- | --- |
| 1인 | `src/play/SoloGame.tsx` | 저장된 1인 기록 + 이전 최고(기기) | 내 기록 | 최고 기록 갱신·첫 기록 때 장착 효과 |
| 사람 vs AI | `src/play/HumanGame.tsx` | 실제 기보 프레임(`fromOfflineFrames`), 기기 최고점 | 사람 좌석만 | 사람이 이겼을 때 장착 효과 |
| 로컬 다인전 | `src/LocalGame.tsx` | MultiReplay 행동을 다시 적용한 카드 기록(`cardsHistoryFromMulti`) | 모든 좌석, 이름 표시 | 단독 승자일 때 기기 장착 효과 |

- 로컬은 "나" 좌석이 없으므로 **단독 승자 기준**으로 역전·하이라이트를 판정하고 이름을 붙인다. 기기 최고 기록·연승은 붙이지 않는다.
- 장착 승리 효과(`FxBurst`)가 있으면 결과 창의 기본 축하 조각을 그리지 않는다. Lv.3 아이템(자체 효과음)이면 결과 강조음도 내지 않는다(`data-effect="item"`).
- 상단 보너스·요트·라지 연출(A2.1 `BonusMoments`, `game-feel`, score-fx)은 그대로다. 결과 창은 큰 점수 연출이 끝난 뒤 열리고(기존 규칙), 승패 기본음은 `game-feel`이 한 번만 낸다.
- 0점 팝업은 `useZeroScoreNotice`가 `useGameSounds`와 같은 규칙으로 카드 변화를 본다(새 경기·동기화 키 변화 무시). 소리는 기존 `scoreZero` 하나.
- 기존 `MatchMilestones`(오프라인 두 화면)는 결과 창 하이라이트로 대체. `src/ui/MatchResult.tsx`는 온라인 화면이 계속 사용한다(C3 수정 중이므로 그대로).
- `MatchResultPanel`은 `visible` prop을 받는다. C3의 `ActivityVisible`이 병합되면 게임 화면에서 그 값을 넘겨 백그라운드 매칭 중 결과 창을 닫아 둔다.

**C3 병합 후 남은 작업**

1. 각 게임 화면의 `<MatchResult>`를 `<MatchResultPanel>`로 교체: 온라인은 `fromOnline(view, reviewEvents, me, { rewards: useRewardState(server, matchId, true), streak, personal })`, AI 대전은 `fromOfflineFrames(record.frames, …)`.
2. 재대결은 기존 `RematchControls`를 `actions.rematchSlot`으로 그대로 넣는다(서버 흐름 불변). 친구 추가는 상대가 회원이고 아직 친구가 아닐 때만 `addFriend` 전달.
3. 장착 승리 특수 효과(`FxBurst`)는 `effect` 슬롯으로 우선 표시. BGM 장면(`useBgmScene`)은 기존 `MatchResult` 동작을 옮긴다.
4. `MatchRewardSummary`/홈 알림 중복 제거는 H-A3-3과 함께 결정.
5. 온라인 0점 팝업: `useZeroScoreNotice(cards, me만, view.version 동기화)`로 재접속·새로고침 따라잡기를 무시.
6. H-A3-1 훅 한 줄, H-A3-2·3은 C3 담당과 순서를 정해 별도 Hotfix PR.

## 9. 검증 결과

1단계(독립 컴포넌트): `tsc -b` 통과, 단위 36/36, 미리보기 Playwright 18/18(desktop·Pixel 7·320px), 전체 `npm test` 557/557, `npm run build` 통과.

2단계(실제 게임 통합, 로컬 실행):
- 단위 `tests/match-result-a3.test.ts` **40/40**: 관찰자 판정, 이름 붙은 0점 알림, H-A3-1 훅(확정 후 1회, 지연·실패 시 갱신 안 함, 재시도)이 추가됐다.
- 실제 UI `tests/ui/a3-match-result.spec.ts`:
  - 로컬 2인 고정 시드 1의 실제 경기로 **대역전승**(8라운드 50점 차), **접전 승리**(4점 차), **마지막 차례 역전**을 확인했다. 기준은 §4다.
  - 0점 팝업이 실제로 뜬다: 첫 차례 "가람 · 라지 스트레이트 0점 기록"이 polite로 읽히고 비난 문구가 없다.
  - 닫기·다시 열기·Esc가 동작하고, 재대결 뒤 결과 창과 팝업이 남지 않는다. 모바일 폭에서 가로 넘침이 없다.
  - 사람 vs AI: 승패 기본음은 정확히 1회이고 다시 열어도 소리가 없다. 게임 리뷰 진입, 재대결, 새로고침 뒤에도 결과 창과 팝업이 다시 뜨지 않는다.
  - 1인: 장착 승리 효과가 기본 조각보다 우선한다.
- 재현 `tests/ui/a3-rematch-records.spec.ts`(로컬 Worker, desktop): 통과(현재 동작 고정). `A3_HOTFIX=1` + 임시 연결로 수정안 통과.
- 기존 스펙(app·multi·pvp·solo·profile)은 새 결과 창 선택자로 갱신했다.

**미검증**: 온라인 화면 통합(C3 대기), 실기기·iOS Safari, 실제 소리 크기 체감, 역전 기준값의 실제 경기 분포, 운영 Worker에서의 재현(로컬 Worker로만 확인).
