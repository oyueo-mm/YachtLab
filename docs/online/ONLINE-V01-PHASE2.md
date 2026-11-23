# YachtLab Online v0.1 — Phase 2: 친구 초대형 1:1 온라인 MVP

> 상태: **로컬 서버에서 실제 WebSocket으로 구현·검증 완료, 미배포.** Cloudflare 리소스 생성·유료 서비스·main 병합·실서비스 배포는 하지 않았다. 배포된 GitHub Pages에는 서버 주소가 설정되지 않으므로 온라인 대전은 계속 "준비 중"으로 보인다.

## 1. 무엇이 되나

친구 두 명이 **각자 다른 브라우저/기기**에서:

1. 닉네임(가입 없음)을 정하고 **방 만들기** → 6자리 **초대 코드**와 **초대 링크**(`?room=CODE#online`)를 받는다.
2. 친구가 링크를 열면 코드가 채워진 입장 화면과 "OO 님의 방에 초대받았어요"가 보인다 → 닉네임 입력 후 **입장**.
3. 대기실에서 방장이 **게임 시작** → 실시간 턴 동기화로 굴리기·고정·재굴림·점수 기록, 12라운드 후 **경기 종료**(승/패/무, 양쪽 점수 동일).
4. **새로고침·탭 닫기·네트워크 끊김·서버 재시작** 후에도 같은 좌석으로 돌아와 이어서 플레이한다.

게임판은 4차 개편 UI를 그대로 쓴다: 3D 물리 주사위(`DiceArea`)·고정 선반·족보 완성 3D 연출(`announceScore`)·점수판·모바일 점수 시트·모바일 주사위판 우선 배치(D-019). 클라이언트는 **서버가 확정한 이벤트만** 렌더링한다. 상대가 고정하는 주사위도 실시간 미리보기로 보인다(표시용, 권한 없음).

## 2. 구성

```
src/online/
  protocol.ts, dice-source.ts, server-engine.ts   Phase 1 엔진 (변경 없음)
  wire.ts      소켓 메시지 타입·검증 (hello / cmd / hold / ping ↔ welcome / view / ack / hold / presence / error)
  room.ts      방 1개: 초대 코드, 좌석 토큰(해시), 명령 직렬 처리, 저장 후 전파, 서버 턴 타이머, 연결·속도 제한
  client.ts    브라우저: 서버 주소, 좌석 저장, HTTP 호출, 자동 재접속 WebSocket
server/online/
  server.ts    로컬 Node 서버(HTTP + ws), 방별 JSON 원자 저장, 재시작 복구, 출처·속도·개수 제한, 빈 방 정리
  main.ts      `npm run online:server`
src/play/OnlineEntry.tsx   닉네임·방 만들기·코드 입장·참가 중인 방
src/play/OnlineGame.tsx    대기실 + 게임판(오프라인과 같은 컴포넌트)
src/online.css
tests/online-server.test.ts   실제 WebSocket 통합 테스트 10개
tests/ui/online.spec.ts       Playwright 두 브라우저 E2E 5개(+모바일 프로젝트 1개)
```

`OnlineRoom`은 Node/Workers API를 쓰지 않는다. 호스트가 `now`, `DiceSource`, `save(record)`, `schedule(at)`, 소켓 래퍼(`RoomConnection`)를 주입한다. 한 방의 메시지는 내부 큐로 **하나씩** 처리되므로 Durable Object(방당 인스턴스 1개, 단일 스레드)와 같은 계약이다. 이후 DO 어댑터는 이 클래스를 그대로 감싸면 된다.

### HTTP / WebSocket

| 요청 | 결과 |
|---|---|
| `POST /api/rooms {name}` | 201 `{code, playerId, token}` — 2인 방 생성 후 방장 착석 |
| `GET /api/rooms/:code` | `{code, status, seats, players}` (토큰·ID 없음, 초대 미리보기) |
| `POST /api/rooms/:code/join {name}` | 201 `{code, playerId, token}` / 404 없는 방 / 409 `NAME_TAKEN`·`MATCH_FULL`·`WRONG_PHASE` |
| `GET /healthz` | 상태 |
| `WS /ws/:code` | 첫 프레임 `{t:"hello", token, since}` → `welcome{view, online, hold}` |

명령은 `{t:"cmd", id, v, action}`. `action`은 Phase 1 `parseCommand`로 다시 검증되고, 플레이어 ID는 **인증된 소켓**에서만 온다(페이로드의 `playerId` 무시).

## 3. 서버 권한·보안

- **서버가 결정:** 턴·주사위(CSPRNG)·점수·종료는 Phase 1 엔진만 결정. 클라이언트의 고정 상태는 `roll{keep}`로만 서버에 전달되고, 실시간 고정 미리보기(`hold`)는 현재 차례인 사람만 보낼 수 있으며 상태를 바꾸지 않는다.
- **좌석 탈취 방지:** 초대 코드는 *대기실의 빈 좌석에 앉는 권한*뿐이다. 좌석마다 256비트 비밀 토큰을 한 번만 발급하고 서버에는 **SHA-256 해시만** 저장(상수 시간 비교). 재접속은 토큰이 있어야 하며, 토큰은 URL·화면에 나오지 않고 그 브라우저의 `localStorage`에만 있다. 방이 차거나 경기가 시작되면 코드로 더 들어올 수 없다.
- **멱등성·재전송:** 응답을 못 받은 명령은 재접속 후 **같은 id**로 다시 보낸다. Phase 1의 `(playerId, commandId)` 중복 검사로 한 번만 적용된다(서버 재시작 후에도 로그에서 복원). `expectedVersion`으로 오래된 화면에서 보낸 명령은 `STALE_VERSION`으로 거부되고 서버가 최신 뷰를 다시 보낸다.
- **동기화:** 재접속 시 `since`(마지막으로 본 version) 이후 이벤트와 전체 상태를 받는다. 새로 받은 이벤트만 연출(굴림·족보)을 재생하고, 재접속 따라잡기는 연출 없이 상태만 맞춘다.
- **저장·복구:** 명령 결과는 **저장 성공 후에만** 메모리 상태에 반영되고 전파된다(저장 실패 시 롤백, fail-closed). 방 파일 = 이벤트 로그 + 토큰 해시. 임시 파일 쓰기 후 `rename`으로 원자 교체. 서버 시작 시 모든 방 로그를 `rebuildFromEvents`로 **재실행 감사** 후 복구하고, 변조·손상된 방은 불러오지 않는다.
- **턴 타이머:** 서버 측 타이머(기본 120초, `ONLINE_TURN_TIMEOUT_MS`, 0이면 끔). 기한이 지나면 서버가 대기 중인 상대 좌석 명의로 결정적 id(`timeout-<version>`)의 `claimTimeout`을 실행 → 시간 초과 기권(2인전은 즉시 종료). 화면에 남은 시간 표시.
- **방장 이탈:** 대기실에서 방장이 나가면 남은 사람이 방장이 된다. 경기 중 이탈은 연결 끊김으로 처리(상대에게 "연결이 끊어졌어요" 안내, 돌아오면 이어서). 경기 중 명시적 포기는 **기권**.
- **닉네임:** 1~24자, 제어 문자 금지(Phase 1 `normalizeName`), 같은 방 안에서 대소문자 무시 중복 금지(`NAME_TAKEN`).

### 남용·비용 방어(로컬 서버 기본값)

| 항목 | 기본값 | 초과 시 |
|---|---|---|
| 허용 출처(Origin) | `127.0.0.1/localhost :5173, :4173` (`ONLINE_ALLOWED_ORIGINS`) | HTTP 403 / WS 업그레이드 거부 |
| 방 생성 / 입장 | IP당 분당 10 / 30회 | 429 |
| 동시 방 수 | 200 (`ONLINE_MAX_ROOMS`) | 503 (fail-closed) |
| 방당 소켓 | 8 | 1013 종료 |
| 메시지 크기 | 2 KB | 1009 종료 |
| 소켓당 메시지 속도 | 버스트 30, 초당 8 | 1008 종료 |
| 방당 이벤트 로그 | 800개(2인 1경기는 약 130개) | 명령 거부 |
| HTTP 본문 | 1 KB | 400 |
| 인증 전 소켓 | 10초 | 4001 종료 |
| 빈 방 정리 | 소켓이 없을 때 대기실 30분·종료 30분·진행 중 24시간 | 방·파일 삭제 |

## 4. 테스트 결과 (로컬, Claude Code 실행)

- `tests/online-server.test.ts` **10개 통과** — 실제 서버·실제 WebSocket: 2인 12라운드 완주와 양쪽 결과 일치, 잘못된 토큰·만석 입장·페이로드 `playerId` 위조 거부, 닉네임 충돌·잘못된 닉네임·없는 방, 중복 명령 1회 적용·차례 위반·오래된 버전, 고정 미리보기 권한, 재접속 `since` 동기화·중복 탭, **서버 재시작 복구·응답 유실 명령 재전송·변조 로그 거부**, 서버 턴 타이머 종료, 방장 승계·빈 방 정리, 출처·메시지 크기·생성 속도·방 수·메시지 폭주 제한.
- `tests/ui/online.spec.ts` (Playwright, 데스크톱 브라우저 + Pixel 7 모바일 브라우저 = 서로 다른 저장소의 두 기기):
  1. 초대 링크 입장 → 게임 시작 → 고정이 상대 화면에 실시간 표시 → 재굴림 시 고정 주사위 유지 → 양쪽 주사위 동일 → **24턴(12라운드) 완주** → 양쪽 결과 화면·점수 일치
  2. 경기 중 새로고침 후 같은 좌석·같은 굴림 상태 복귀(URL에 토큰 없음), 상대 탭 종료 시 연결 끊김 안내, 초대 링크로 새 탭에서 좌석 복귀 후 계속 진행, 코드만 아는 제3자 입장 거부
  3. **서버 프로세스 재시작** 중 "다시 연결하는 중" 안내 → 자동 재접속 → 저장된 경기 이어서 플레이
  4. 대기실 닉네임 충돌 안내, 방장 나가기 후 승계, 없는 코드 안내
  5. 서버 미설정 배포본은 "준비 중", 루프백이 아닌 `online-server` 파라미터는 무시

전체 결과(`npm test`, `npm run build`, 전체 Playwright)는 PR #44 본문/댓글에 기록한다.

## 5. 로컬에서 직접 해보기

```bash
npm ci
npm run online:server            # http://127.0.0.1:8787 (방 파일: .online-data/)
npm run dev                      # http://127.0.0.1:5173/YachtLab/
# 브라우저 A: http://127.0.0.1:5173/YachtLab/?online-server=http://127.0.0.1:8787#online → 방 만들기
# 브라우저 B(다른 브라우저 또는 시크릿 창): A의 "초대 링크 복사" 주소를 연다 → 닉네임 → 입장
```

`?online-server=`는 **루프백 주소(127.0.0.1/localhost)만** 받는다. 실제 서버 주소는 빌드 시 `VITE_ONLINE_SERVER_URL`(https만)로만 정한다.

## 6. 실서비스 배포에 필요한 것 (승인 전 미실행)

설계 후보는 PR #44 지침대로 **Workers + SQLite-backed Durable Objects + WebSocket Hibernation**이다.

1. **DO 어댑터 작성:** Worker가 `/api/rooms`·`/ws/:code`를 받아 방 코드로 `idFromName(code)`의 DO에 전달. DO는 `OnlineRoom`을 감싸고, `save` → SQLite 트랜잭션(이벤트 append + 토큰 해시), `schedule` → `storage.setAlarm`, 소켓 → Hibernation API(`acceptWebSocket`, `webSocketMessage`, 연결 메타데이터에 playerId/seenSeq 직렬화). 방 생성 속도·전체 방 수 제한은 별도 전역 DO 또는 Workers Rate Limiting 바인딩으로 이동.
2. **Wrangler 설정:** `wrangler.toml`에 DO 바인딩·`new_sqlite_classes` 마이그레이션, 허용 출처 `https://oyueo-mm.github.io`. 로컬 `wrangler dev`(Miniflare)로 이 문서의 테스트를 다시 통과시킨 뒤 배포.
3. **프런트:** GitHub Pages 빌드에 `VITE_ONLINE_SERVER_URL=https://<worker 도메인>`(Actions 변수). 설정 전까지 온라인은 "준비 중".
4. **운영:** 무료 한도 도달 시 요청이 거부되도록(fail-closed) 계정이 **Free 플랜인지, 결제 수단·유료 플랜이 없는지** 소유자가 확인. 대시보드 사용량 알림, 로그 보존 기간, 개인정보(닉네임만 저장) 고지.
5. **아직 없는 것:** 공개 매칭·랭킹·채팅·계정, 관전, 재대결 버튼(현재는 새 방 만들기), 3~8인 온라인 UI(엔진은 지원), 이벤트 로그 HMAC/앵커링, 부하 테스트.

## 7. 예상 비용 — **확인 필요**

이 작업 환경에서는 Cloudflare 공식 요금 페이지([DO 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/))에 접속할 수 없어(네트워크 정책) **현재 수치를 확인하지 못했다.** 아래는 사용량 추정이며 요금 판단은 배포 직전에 공식 페이지와 실제 계정 설정으로 다시 확인해야 한다. **$0이라고 단정하지 않는다.**

- 1경기(2인, 12라운드) 서버 사용량 추정: HTTP 2회(생성·입장) + WS 연결 2~4회, 클라이언트 → 서버 메시지 약 60~120개(굴림·점수·고정 미리보기·핑), 저장(이벤트 append) 약 60~70회, 저장 크기 약 20~40 KB(종료 후 정리로 삭제).
- Workers Free + SQLite DO의 무료 일일 한도 범위 안에서는 소규모 친구 대전(하루 수십~수백 경기)이 수용될 것으로 **예상**되지만, 정확한 일일 요청·실행 시간(GB-s)·SQLite 행 읽기/쓰기 한도와 WebSocket 메시지 과금 비율은 공식 문서로 재확인해야 한다.
- Free 플랜에서 한도 초과 시 과금이 아니라 요청 실패가 되는지, 계정에 유료 플랜이 켜져 있지 않은지를 배포 전 소유자가 확인해야 한다.
- GitHub Pages 프런트는 기존과 같다.
