# SOC-1 온라인·친구·매칭·관전 확장 (+SEC-1 1차 감사 반영) — 2026-11-28

> 담당 04. 결정 D-SOC1-1~6. **운영 미배포.** 이 PR이 main에 병합되면 D-100에 따라 Worker가 자동 배포되므로, **병합 자체가 운영 배포 승인**이다(Worker 리소스·바인딩·마이그레이션 변경 없음 → 보호 입력 아님).
> 01 담당자(전역 친구 패널·공통 헤더·매칭 팝업 디자인)에게 넘기는 **API 계약·상태 전이·연동 방법·테스트 시나리오**가 이 문서다.

## 0. 이미 있던 것 / 이번에 한 것

| 영역 | 기존(재사용) | SOC-1에서 추가 |
|---|---|---|
| 친구 | 친구 코드(YL+8)·코드/정확 닉네임 검색·요청·수락·거절·취소·삭제·차단(I/J, C4.2 세대 코드) | **계정 ID 기반 관계 조회·요청**(최근 상대·같은 방 구성원만), **로그인 시 친구 코드 자동 등록**, 미등록 계정은 조회 시 즉시 등록(복구), 친구 링크 공유(`?friend=YL…#friends`), 친구 프로필에 **나와의 상대 전적**·대표 업적 |
| 접속 상태 | 계정 DO 메모리, 친구 목록에서 친구 수만큼 DO 호출 | **FriendIndex DO의 중앙 상태(한 번 호출)**, 탭/기기별 하트비트, 탭 종료 알림, `unknown`(상태 확인 불가), 비공개 설정 |
| 대전 초대 | 대기실에서 친구 초대·초대 카드 수락/거절·10분 만료 | **친구 목록에서 바로 대전 신청**(방 생성+초대), 중복 신청 → 같은 방, 경기 중 친구 안내(BUSY), **보낸 쪽의 수락/거절/만료/취소 상태**, 보낸 초대 취소 |
| 대기실 관전(C3.1) | 외부 관전 범위(D-095)·관전 ID(PR118-01) | **방 구성원과 경기 참가자 분리**: 준비/이번 경기 관전/취소, 관전자는 인원·준비·보상·전적·외부 관전 키 제외, 경기 후 **대기실 복귀**와 역할 재선택 |
| 전역 매칭(A6) | C3 서버 큐·경쟁 처리·티켓 복구·30초 AI 안내 | **성사 알림 + 3초(연습 중 5초) 카운트다운·지금 입장**, 카운트다운 중 새로고침 복구, **브라우저 탭 하나만 대기**(다른 탭에서 취소 요청) |
| 대표 업적 | 기기 로컬 3칸(`PinStore`) | **서버 저장**(달성한 것만·중복/초과 거절), 다른 기기 동기화, 공개 프로필 표시, 공개 범위(public/friends/private)·차단 적용 |
| SEC-1 | — | 공개 프로필 차단 반영, 차단 정책 일관성, 본문 크기 **읽기 전** 검사, 입력 검증·남용 제한 (§7) |

새 서버 AI·다인전 AI·게임 규칙은 만들지 않았다. Worker 리소스·DO 클래스·마이그레이션 추가 없음(Workers Free 유지).

## 1. 기능 플래그와 호환성

`GET /api/features`에 `lobbyWatch: true`, `social: <로그인 가능 여부>`가 추가됐다.

| 조합 | 동작 |
|---|---|
| 신형 Pages + 구형 Worker | 관계 조회 404 → 버튼 대신 "친구 코드로 추가" 안내(추정 없음). `inbox.sent` 없음 → 보낸 신청 목록 숨김. `lobby.intent` 없음 → 기존 준비 버튼만. 대표 업적 GET 404 → 기기 저장 유지. 대전 신청 버튼은 신형 Worker(`friends.presence:"v2"`)에서만 보인다. |
| 구형 Pages + 신형 Worker | 응답 필드는 추가만(`sent`, `settings`, `presence:"v2"`, `pins`, `relation`, `versus`, `role`, `lobby.intent/watchers/minPlayers`). `ready` 메시지는 `intent` ready/idle로 해석. 상태 `"unknown"`은 구형 화면에서 라벨이 비지만 오류는 없음. 구형 화면은 관전을 고를 수 없으므로 항상 참가. |
| C3.1 이전에 저장된 방 | `members` 없음 → 좌석 = 구성원으로 읽고, 다음 입장 때 `members`를 채운다(테스트 있음). |

## 2. API 계약 (01 친구 패널용)

모든 경로는 회원 세션(`Authorization: Bearer s1.…`) 필요, POST/PUT은 허용 Origin 필요, 본문 ≤ 4096바이트(§7). 오류 형식은 기존 `{error:{code,message}}`.

| 메서드·경로 | 입력 | 응답 | 비고 |
|---|---|---|---|
| `GET /api/me/friends` | — | `{me:{code,nickname,settings?}, friends:[{code,nickname,since,status}], incoming, outgoing, blocked, presence?:"v2"}` | `status ∈ online·playing·offline·unknown`. 친구 패널 폴링은 **화면이 보일 때 60초**(기존과 같음) |
| `GET /api/me/inbox?device=<tabId>` | `device`: `[A-Za-z0-9_-]{8,40}` | `{requests, invites:[RoomInvite], sent?:[SentInvite]}` | **이 호출이 그 탭의 하트비트**. 60초마다, 화면이 보일 때만. 새 알림 배지는 `requests`·`invites.length`·`sent`의 상태 변화로 |
| `POST /api/me/presence` | `{device, state:"online"\|"offline"}` | `{ok:true}` | `pagehide`에서 `keepalive` fetch로 `offline`(그 탭만). 분당 30 |
| `GET /api/me/friends/relation?userId=u_…[&room=CODE]` | 내 서버 검증 기록의 상대 또는 같은 방에 지금 앉은 회원 | `{relation, code, nickname}` | 그 밖의 ID는 404(존재 여부 탐색 불가). 나를 차단한 상대는 `none`과 구별 불가. 코드 없는 계정은 이때 등록 |
| `POST /api/me/friends/request` | `{code}` 또는 `{userId, room?}` | `{status:"sent"\|"friends"}` | userId 경로는 relation과 같은 권한 검사 후 서버가 코드로 변환 |
| `POST /api/me/friends/challenge` | `{code}` | 201 `{status:"sent", code, playerId, token, invite}` / 200 `{status:"pending", invite}` | 실패: `BUSY`(친구가 보이는 상태로 경기 중), `NOT_FRIEND`, `RATE_LIMITED`(분당 6), 방 생성 한도 |
| `POST /api/me/invites/accept` | `{id}` | 201 좌석 | 보낸 사람 `sent[].state = accepted` |
| `POST /api/me/invites/decline` | `{id}` | `{ok}` | 보낸 사람 `declined` |
| `POST /api/me/invites/cancel` | `{id}` (내가 보낸 것) | `{ok}` | 받은 사람 초대 카드에서 사라짐, 내 목록 `cancelled` |
| `GET/POST /api/me/friends/settings` | `{presence?:"friends"\|"hidden", pinsVisibility?:"public"\|"friends"\|"private"}` | `{settings}` | 분당 10 |
| `GET /api/me/profile/pins` · `PUT(POST) /api/me/profile/pins` | `{ids:string[]}` | `{pins, visibility, max:3}` / `{pins}` | `PINS_NOT_EARNED`·`PINS_DUPLICATE`·`PINS_TOO_MANY`·`PINS`. 같은 값이면 쓰기 없음 |
| `GET /api/me/friends/profile?code=` | — | 공개 프로필 + `code, relation, versus?, pins?` | 상대가 나를 차단 → 404 |
| `GET /api/profiles/:userId` | (세션 있으면 함께) | 공개 프로필 + `pins?` | 세션 사용자를 상대가 차단 → 404(없는 계정과 같은 메시지). 익명은 `public` 대표 업적만 |

`SentInvite = {id, to:{code,nickname}, room, at, expires, state: pending|accepted|declined|expired|cancelled, kind: room|challenge}` — 최근 30분, 최대 50건.

클라이언트 함수(`src/identity/friends-client.ts`): `friends`, `inbox`(tabId 자동), `presenceGoodbye`, `challengeFriend`, `cancelInvite`, `friendSettings`/`setFriendSettings`, `serverPins`/`saveServerPins`, `friendLink`/`linkedFriendCode`, `tabId`. 계정 ID 친구 요청 버튼은 기존 `FriendRequestButton`(`room` prop 추가)을 그대로 쓴다. 받은함 상태는 `useInbox()`(`sent` 포함), 폴링 시작은 `startInbox(server)`가 이미 App에서 한 번 한다 — **패널은 별도 폴링을 만들지 말고 `useInbox()`와 `friends()`(패널이 열렸을 때만)를 쓴다.**

## 3. 상태 전이

**친구 접속 상태** (서버 FriendIndex, 친구별):

```
(재시작 직후 2분30초, 하트비트 없음) unknown ──beat──▶ online
online ──모든 탭 offline 알림──▶ offline       online ──마지막 beat+150s──▶ offline (비정상 종료·네트워크)
* ──방: 경기 시작──▶ playing (저장, 최대 3시간) ──경기 종료──▶ online/offline
* ──설정 hidden──▶ offline(친구에게)        조회 실패 ▶ unknown
```
보이는 조건: 내 목록의 친구 **이고** 그 친구도 나를 친구로 가짐(온라인/경기 중으로 보일 때만 확인). 방 코드·경기 종류는 절대 응답에 없다.

**대전 신청** (보낸 쪽 `sent[].state`): `pending → accepted | declined | cancelled`, 10분 경과 시 `expired`(읽을 때 계산). 같은 친구에게 `pending`이고 방이 아직 대기 중이면 새 방을 만들지 않고 `pending` 반환. 차단당했으면 `pending`으로 보이다가 만료(차단 비공개).

**대기실(C3.1)** 구성원별 `intent`: `idle ⇄ ready`, `idle ⇄ watch`, `ready ⇄ watch`(대기실에서만). 시작: 참가자 = `watch`가 아닌 구성원 ≥ 2, 방장 아닌 참가자는 준비(1:1 방에 관전자가 없으면 기존처럼 바로 시작). 경기 중 관전 구성원은 `role:"watcher"`, 중립 화면(`view.you = null`), 명령·채팅 불가, 외부 관전 키·sid 없음, 기록·보상·`playing_users` 잠금·"경기 중" 표시 없음. 종료 후 **방장 `{t:"return"}`** → 남은 모든 구성원이 대기실로(의도 초기화, 다음 경기 번호, 예산 1단위 이상). 기존 재대결(`rematch`)은 그대로 동작하며 관전 구성원은 관전자로 남는다. 관전 구성원 `bye`는 언제든 방을 떠남. 방장이 관전 중이어도 방장 권한(시작·범위·복귀·이양) 유지.

**전역 매칭(A6)** `MatchController.state.phase`:

```
idle → connecting → waiting ⇄ reconnecting → pairing → matched(until) → entering → idle(entered)
waiting/connecting → cancelling → idle            (취소와 성사가 겹치면 성사가 이김: 서버가 이미 방을 만들었음)
idle →(다른 탭이 대기 중) elsewhere → idle        (그 탭이 끝나거나 잠금이 20초 갱신 안 되면)
* → error(DUPLICATE·IN_MATCH·EXPIRED·NETWORK·ENTRY_FAILED…)
```
`matched`: 3초(오프라인 AI 게임을 잠시 둘 때 5초) 뒤 자동 입장, `enterNow()`로 즉시. 거절 버튼은 없다(D-094: 성사 = 경기 시작, 거절하면 상대 기권승). 카운트다운 중 새로고침 → 같은 경기로 바로 입장(탭별 2분 기록). 대기 30초 뒤 "기다리는 동안 오프라인 AI" 안내(매칭 계속). 오프라인 AI 게임은 App의 기존 일시 보존(`suspended`)으로 온라인 경기 뒤 이어서 한다 — 온라인/오프라인 상태는 섞이지 않는다.

01에게: 팝업의 드래그·최소화·복원·시각 디자인은 `MatchPopup`을 대체해 같은 `MatchController`(`state, display, setDisplay, start, cancel, reconnect, enterNow, cancelOther, entered, entryFailed`)와 `practicePaused`를 쓰면 된다. `matched` 화면에는 상대 닉네임, 남은 초, "지금 입장", (연습 중이면) 보존 안내를 꼭 둔다.

## 4. 비용 (Workers Free)

| 동작 | 이전 | SOC-1 |
|---|---|---|
| 친구 목록 1회(친구 N명) | 내 DO `peerId` N회 + 친구 DO `presence` N회 | 내 DO `friendPeers` 1회 + FriendIndex 1회 + **온라인으로 보이는 친구 수**만큼 상호 확인 |
| 하트비트(탭당 60초) | 계정 DO 1회 | 계정 DO 1회 + FriendIndex 1회(메모리, **쓰기 없음**) |
| 경기 시작/종료 | 계정 DO 회원 수만큼 | + FriendIndex 1회(참가자당 행 쓰기 1) |
| 탭 종료 | — | 요청 1회(keepalive) |
| 대표 업적 저장 | — | 바뀔 때만 행 1 |
| 대전 신청 | — | 방 생성(기존 한도) + 초대 + 보낸 기록 행 1 |

FriendIndex는 전역 단일 객체다. 하트비트가 몰리는 규모(동시 접속 수천)에서는 샤딩이 필요하다(후속). 운영 요청량·CPU는 **측정하지 않았다**.

## 5. 다인전 확인 (기존 최대 20명, `MAX_PLAYERS`)

`tests/lobby-watch.test.ts`: 20인 방에서 2명 관전 + 18명 동시 진행 시작, 진행 상황 18명, 예산 9단위(생성 1 + 8). 기존 `tests/online-multi.test.ts`(10인 동시 진행 12라운드·시간 초과 자동 기록·기권·재접속·재대결 일부)와 `multi-online.spec.ts`는 그대로 통과(§6). 탈퇴·세션 정리·친구 잔존 정책(C4.2)은 바꾸지 않았고, 탈퇴 시 중앙 접속 상태와 보낸 초대 기록도 지운다.

## 6. 검증

| 시나리오 | 테스트 |
|---|---|
| 같은 닉네임 두 계정, 계정 ID로 정확한 사람에게만 / 모르는 ID 404 / 차단·탈퇴 계정 | `tests/soc1-social.test.ts` |
| 친구 코드 미등록 → 조회 시 등록, 로그인 시 자동 등록 | 같은 파일, `tests/soc1-worker.test.ts` |
| 다중 탭·기기, 비정상 종료 TTL, 재시작 직후 unknown, 명시적 종료는 offline, 비공개, 한쪽만 친구 | `soc1-social`, `soc1-worker` |
| 친구 목록 중앙 조회 1회(친구 12명, 계정별 상태 조회 0회) | `soc1-social` |
| 대전 신청 수락·거절·만료·취소·중복·BUSY·남용 | `soc1-social`, `soc1-worker` |
| 대기실 관전·역할 변경·방장 관전·대기실 복귀·관전자 퇴장·20인·구 기록 호환 | `tests/lobby-watch.test.ts` |
| 매칭 탭 잠금·카운트다운·새로고침 복구 | `tests/match-flow.test.ts` |
| 대표 업적 검증·공개 범위 | `soc1-social`, `soc1-worker` |
| SEC-1 본문 크기·입력 검증·차단 | `tests/body-limits.test.ts`, `soc1-worker` |

결과(이 샌드박스, 2026-11-28, 커밋 기준 최신): `npm test` 84 파일 통과·1 skip, 802 중 801 통과·1 skip. `npm run build` 통과. Playwright(로컬 wrangler·Node 서버, 미리 설치된 Chromium `PW_CHROMIUM_PATH`): 친구·A4 친구·빠른 대전·다인전 온라인·온라인(Node+Workers)·입장·프로필·A3 재대결·A2 온라인 10개 파일 **55 통과, 45 skip(모바일 프로젝트에서 테스트 스스로 건너뜀), 실패 0**. 전체 Playwright 결과는 PR 본문에 기록. **운영 서비스에서 실제 사용자와의 테스트 매칭은 하지 않았다**(전부 로컬 wrangler·Node 서버).

기존 테스트 변경: `tests/ui/a4-friends.spec.ts`(D-091의 "서버 보증이 없으니 보내지 않는다"가 SOC-1로 "서버 보증 뒤에만 버튼, 자동 전송 없음, 한 번에 한 건"으로 바뀜 — 계정 전환 격리 단언은 유지), `tests/account-security-worker.test.ts`(받은함 응답에 `sent: []` 추가), `tests/friends.test.ts`(가짜 초대 ID를 운영과 같은 UUID 형태로), `tests/friend-relations.test.ts`(liveApi 테스트 이름: 서버가 대응을 보증하지 못하면 보내지 않는다 — 단언 동일).

## 7. SEC-1 1차 감사 반영

| 항목 | 조치 |
|---|---|
| 공개 프로필 차단(B-26) | `/api/profiles/:id`가 세션이 있으면 확인: 대상이 나를 차단 → 404(없는 계정과 동일). 대표 업적은 공개 범위·차단 적용. 경기 중 상대 프로필은 세션을 보내므로 같이 적용 |
| 검색·요청·초대 일관성 | 검색: 나를 차단한 사람 숨김(기존). 요청: 차단당했으면 성공처럼 보이고 저장 안 됨 — 코드·계정 ID 경로 모두. 관계 조회: `none`. 친구 프로필: 404. 초대·대전 신청: 친구만(차단 = 친구 해제), 차단당한 쪽 초대는 저장 안 되고 보낸 쪽은 `pending→expired`. 차단 시 보낸 초대 기록도 삭제 |
| 접속 상태·관전 정보 | 상호 친구만, 비공개 설정, 방 코드·경기 종류 비노출, 관전 구성원에게 외부 관전 키·sid 없음, 탈퇴 시 중앙 상태 삭제 |
| 본문 크기 사전 검사 | `worker/src/limits.ts`: Content-Length가 한도 초과면 읽지 않음, 길이 없는 스트림은 한도를 넘는 순간 중단. 친구·초대·상태·설정·대표 업적(4096), 방 생성·참가(1024), 계정 경로(기존 한도) 모두 적용 |
| 입력 검증 | 계정 ID 정규식, 친구 코드 정규화, 기기 ID, 초대 ID(UUID 형태), 설정 열거값, 대표 업적(배열·카탈로그 ID·달성 여부·중복·개수), 방 코드 |
| 남용 방지(분당, isolate 단위) | 관계/ID 요청 30, 대전 신청 6, 초대 수락·거절·취소 30, 상태 30, 설정 10, 대표 업적 20 + 기존(검색 20·하루 200, 요청 10·하루 30, 초대 20, 계정 120) |

**후속 보완 SOC-1-F1 (기록, 이번 범위 밖):** 빠른 대전에서 한쪽이 다른 쪽을 차단한 두 회원이 짝지어지는 것을 막지 않는다(허브가 차단 목록을 모름 — 짝짓기 전 확인은 추가 DO 호출이 필요해 별도 설계). isolate 단위 제한은 여러 isolate에 걸친 정밀 제한이 아니다(기존과 같음).

### 알려진 간헐 실패 (SOC-1과 무관, 기록)

전체 Playwright(2 worker) 실행에서 `tests/ui/game-flow.spec.ts:313` "WebGL을 쓸 수 없으면 2.5D 연출로 대체…"가 **모바일 프로젝트에서 1회 실패**했다(`lastRoll(page)`가 `null`, 즉 굴림 기록이 아직 없을 때 단언). 같은 테스트를 단독 실행하면 데스크톱·모바일 모두 통과했다. 이 테스트는 오프라인 주사위 연출 경로이며 SOC-1이 바꾼 파일과 겹치지 않는다. 병렬 부하에서의 타이밍 경합으로 보이나 **원인을 확정하지 않았다**. 테스트 자체를 건너뛰거나 완화하지 않았다.

## 8. 남은 일

- 01: 전역 친구 패널·헤더 배지·매칭 팝업 디자인(위 계약 사용), "상태 확인 불가" 아이콘.
- 운영 배포(병합 = 자동 배포, D-100) 후 실제 요청량·FriendIndex CPU 측정.
- **SOC-1-F1 빠른 대전 차단 쌍 회피**(후속 보완): 허브가 짝짓기 확인 단계에서 두 회원의 차단 여부를 계정 객체에 묻고, 차단 관계면 그 쌍만 건너뛰고 대기 순서를 유지하는 설계 후보. 추가 DO 호출·대기 지연 영향을 함께 측정해야 한다.
- FriendIndex 샤딩(규모 증가 시), 구형 화면의 `unknown` 라벨, `game-flow.spec.ts:313` 모바일 간헐 실패 원인 확인.
