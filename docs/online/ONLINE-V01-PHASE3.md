# YachtLab Online v0.1 — Phase 3: Cloudflare Workers + SQLite Durable Objects

> 상태: **구현 및 로컬 Cloudflare 런타임(`wrangler dev --local`, workerd) 검증 완료, 미배포.**
> 실제 Cloudflare 리소스 생성, `wrangler deploy`, 원격 개발 환경(`--remote`), 유료 전환·결제 정보 등록은 하지 않았다. Cloudflare 계정·API 토큰도 사용하지 않았다.

## 1. 구성

```
브라우저(GitHub Pages)  ──HTTP──▶  Worker (stateless)
        │                         ├─ Origin/CORS 검사, 본문 1 KB 제한, 라우팅
        └──WebSocket /ws/:code ─▶ ├─ RoomDirectory DO (1개): 사용 중 방 코드, 전체 방 수 한도, IP 해시별 속도 제한, 시간별 정리
                                  └─ YachtRoom DO (방마다 1개, idFromName(code)):
                                       Phase 2 OnlineRoom(엔진·좌석 토큰·멱등성·타이머) + SQLite + Hibernation WebSocket + 알람
```

- **재사용:** Phase 1 엔진(`src/online/server-engine.ts`), Phase 2 방 로직(`src/online/room.ts`)·소켓 프로토콜(`wire.ts`)·웹 클라이언트·온라인 UI를 그대로 쓴다. HTTP/WS 경로가 로컬 Node 서버와 같으므로 프런트는 서버 주소만 바꾸면 된다.
- **`worker/src/host.ts` (`RoomHost`)**: Cloudflare import가 없는 DO 로직. 저장소·소켓·알람을 인터페이스로 받으므로 Node 테스트에서 Hibernation을 시뮬레이션할 수 있다.
- **`worker/src/index.ts`**: Worker 라우팅, `YachtRoom`(DO 셸), `RoomDirectory`.
- **`worker/wrangler.toml`**: DO 바인딩 2개, `new_sqlite_classes` 마이그레이션(Workers Free는 SQLite DO만 지원), 변수 기본값, `workers_dev = false`, `preview_urls = false`.

### 영속화 (SQLite)
- 방 레코드(이벤트 로그 + 좌석 토큰 **해시** + 생성·최근 활동 시각)를 **한 행**(`room` 테이블, `id = 1`)에 저장한다. 명령 하나 = 행 쓰기 1회이고, 단일 행 교체이므로 원자적이다.
- DO 출력 게이트 덕분에 SQLite 쓰기가 확정되기 전에는 응답·브로드캐스트가 나가지 않는다(저장 후 전파 보장). Phase 2의 롤백 경로도 유지된다.
- 깨어날 때마다 `rebuildFromEvents`로 로그를 **재실행 감사**한 뒤 복구한다. 측정 결과 완주 경기(125 이벤트) 기준 중앙값 1.5 ms, 최대 4.1 ms (로컬 Node).

### WebSocket Hibernation
- `ctx.acceptWebSocket()`으로 소켓을 받아, 이벤트가 없으면 DO가 메모리에서 내려가도(duration 과금 없음) 연결은 유지된다.
- 각 소켓의 player id·전달한 마지막 seq·속도 버킷은 `serializeAttachment()`에 저장되고, 깨어나면 `ctx.getWebSockets()`로 다시 채택(`OnlineRoom.adopt`)한다.
- 클라이언트 keep-alive `{"t":"ping"}`은 `setWebSocketAutoResponse`로 런타임이 직접 `{"t":"pong"}` 응답 → **DO를 깨우지 않고 요청·duration 과금도 없다**.

### 타이머 (DO 알람 1개)
`턴 제한(기본 120초)`, `인증 전 소켓 10초`, `보존 기간 정리` 중 가장 이른 시각으로 알람을 맞추고, **값이 바뀔 때만** `setAlarm`을 호출한다(행 쓰기 절약). 턴 만료 시 Phase 2와 같은 결정적 id의 `claimTimeout`을 실행한다.

### 보존 기간·자동 정리
| 상태 | 소켓이 없을 때 삭제까지 | 변수 |
|---|---|---|
| 대기실 | 30분 | `LOBBY_IDLE_MS` |
| 종료 | 30분 | `FINISHED_IDLE_MS` |
| 진행 중 | 24시간 | `PLAYING_IDLE_MS` |
| 모든 방(연결 여부 무관) | 생성 후 48시간 | `ROOM_MAX_AGE_MS` |
| 모두 나간 대기실 | 즉시 | — |

정리 시 `deleteAlarm()` + `storage.deleteAll()`로 방 데이터를 모두 지우고 디렉터리에서 코드를 해제한다. 디렉터리는 매시간 지난 속도 제한 기록과 보존 기간을 넘긴 코드를 지운다. 저장되는 개인정보는 닉네임뿐이며 IP는 SHA-256 해시(앞 12바이트)로만 속도 제한에 쓴다.

### 남용 방어 (기본값, `[vars]`로 조정)
| 항목 | 기본값 | 초과 시 |
|---|---|---|
| 허용 출처 | `ALLOWED_ORIGINS` (로컬 주소만) | 403 |
| 방 생성 | IP당 분당 10 (`CREATE_PER_MINUTE`) | 429 |
| 입장 / 초대 미리보기·소켓 연결 | IP당 분당 30 / 120 (`JOIN_PER_MINUTE`) | 429 |
| 동시 방 | 200 (`MAX_ROOMS`) | 503 |
| 방당 소켓 / 방당 연결 시도 | 8 / 분당 40 | 503 / 429 |
| 메시지 크기 / 속도 | 2 KB / 버스트 30·초당 8 | 1009 / 1008 종료 |
| 방당 이벤트 | 800 | 명령 거부 |
| HTTP 본문 | 1 KB | 400 |
| 없는 코드 | 디렉터리에서 거부 → 방 DO를 만들지 않음 | 404 |

## 2. 검증 (로컬, 2026-11-23)

| 항목 | 결과 |
|---|---|
| `tests/online-worker.test.ts` — 실제 `wrangler dev --local`(workerd, SQLite DO, Hibernation API, 알람) | **9개 통과**: 12라운드 완주·양쪽 결과 일치, 좌석 탈취(잘못된 토큰·만석·`playerId` 위조), 중복 명령·잘못된 차례·오래된 버전, 닉네임·없는 방·미리보기 토큰 비노출, 재접속 `since`·중복 탭·**자동 pong**·고정 미리보기, **wrangler 재시작 후 SQLite 복구**·응답 유실 명령 재전송·저장 파일에 토큰 원문 없음, **알람 턴 타이머**, **보존 기간 알람 삭제·빈 방 즉시 삭제·방 수 한도 해제**, 방장 승계·출처·메시지 크기·생성 속도·메시지 폭주 |
| `tests/online-host.test.ts` — DO 로직 + 가짜 런타임 | **4개 통과**: **Hibernation 축출 후 같은 소켓으로 이어서 플레이**(첨부 데이터로 재채택, 중복 명령 인식, 다른 소켓에 새 이벤트만 전달), 알람 하나로 턴·인증 전 소켓·보존 기간 처리 후 저장소 삭제, 연결 수·연결 속도 제한, 깨어날 때 감사 비용 |
| `tests/ui/online.spec.ts` — Playwright, 데스크톱 + Pixel 7 두 브라우저 | 같은 4개 시나리오를 **로컬 Node 서버와 Workers(wrangler dev) 양쪽**에서 실행: 12라운드 완주, 새로고침·탭 종료·재입장·제3자 거부, **서버(워커) 재시작 후 자동 재접속·이어서 플레이**, 대기실 예외 |
| API 호환성 | `@cloudflare/workers-types`로 `tsc -p worker/tsconfig.json` 통과(`npm run build`에 포함), 실제 workerd 런타임에서 `DurableObject` 클래스, RPC 메서드, `ctx.storage.sql`, `acceptWebSocket`/`serializeAttachment`/`getWebSockets`, `setWebSocketAutoResponse`, `setAlarm`/`deleteAll` 동작 확인 |

전체 `npm test`·`npm run build`·Playwright 결과는 PR #44에 기록한다.

**로컬 검증의 한계:** `wrangler dev --local`은 실제 축출(hibernation) 시점을 강제할 수 없어 축출 후 복구는 `RoomHost` 단위 테스트로 검증했다. 실제 엣지 네트워크의 지연·위치·동시 접속 부하, 계정 단위 무료 한도 집계, 대시보드 설정은 배포 전까지 검증할 수 없다.

## 3. 사용량과 비용 — 공식 문서 기준

출처(2026-11-23 확인): [Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/)(2026-11-13 갱신), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)(2026-11-18), [DO 한도](https://developers.cloudflare.com/durable-objects/platform/limits/)(2026-11-13), [Workers 한도](https://developers.cloudflare.com/workers/platform/limits/)(2026-11-19).

**Workers Free 공식 수치**
- Workers 요청 100,000/일, 호출당 CPU 10 ms. WebSocket 연결은 업그레이드 요청 1건이며 Worker를 거치는 메시지는 요청으로 세지 않음.
- Durable Objects(Free는 SQLite 백엔드만): 요청 100,000/일(HTTP·RPC 세션·WebSocket 메시지·알람 호출 포함, **수신 WebSocket 메시지는 20:1로 환산**, 송신 메시지·프로토콜 핑 무료), duration 13,000 GB-s/일(128 MB 기준, 동면 가능 상태는 과금 없음, auto-response는 duration 없음).
- SQLite: 행 읽기 5,000,000/일, **행 쓰기 100,000/일**(삭제와 `setAlarm` 1회도 행 쓰기 1회), 저장 5 GB(계정 전체), DO당 1 GB.
- **무료 한도를 넘으면 해당 작업이 오류로 실패**하며 매일 00:00 UTC에 초기화된다. Workers Paid는 월 최소 $5이고 초과분이 과금된다.

**1경기(2인, 12라운드) 측정·추정** — 50경기 시뮬레이션(턴당 1~3회 굴림, 재굴림마다 고정 미리보기 2회):

| 항목 | 1경기 | 근거 |
|---|---|---|
| 방 DO 행 쓰기 | 레코드 약 75 + 알람 30 + 연결 종료·정리 약 4 ≈ **110** | 측정 |
| 디렉터리 행 쓰기 | 생성 2 + 입장 1 + 소켓 연결 2~4 + 해제 1 ≈ **8** | 코드 |
| DO 요청 | 수신 메시지 123 ÷ 20 ≈ 6 + RPC(생성·입장·미리보기) 3 + 업그레이드 2 + 알람 1~2 + 디렉터리 RPC 약 6 ≈ **19** | 측정+코드 |
| Worker 요청 | 생성·미리보기·입장·업그레이드 2 ≈ **5~6** | 코드 |
| Duration | 이벤트 처리 시간만(동면 가능) ≈ 150회 × 수 ms × 0.125 GB ≈ **0.2 GB-s** | 추정 |
| 저장 | 레코드 약 16 KB, 보존 기간 뒤 삭제 | 측정 |

**하루 무료 범위로 환산(다른 사용이 없을 때)**: 행 쓰기 기준 약 **830경기/일**(가장 먼저 닿는 한도), DO 요청 기준 약 5,000경기, Worker 요청 기준 약 16,000경기, duration 기준 수만 경기. 동시 방은 `MAX_ROOMS` 200개로 제한된다.

**비용 위험 판단**
- 계정이 **Workers Free**이면 한도 초과 시 과금이 아니라 **실패**한다. 즉 위험은 비용이 아니라 **그날 남은 시간 동안 온라인 대전 중단**(서비스 거부)이다.
- **Workers Paid로 전환된 계정**에서는 같은 남용이 과금으로 이어진다. 그 경우 [DO 지출 한도](https://developers.cloudflare.com/durable-objects/platform/spend-management/) 설정이 필요하다(본 작업에서는 설정하지 않음).
- 주요 남용 경로와 완화: 여러 IP에서 방 생성·소켓 연결 반복(행 쓰기 소모) → IP당 속도 제한·방 수 한도로 완화하지만 분산 공격은 막지 못한다. 배포 시 Cloudflare 대시보드의 WAF 속도 제한 규칙 사용을 검토(무료 플랜 제공 범위는 배포 전 확인 필요).
- 따라서 **$0은 계정이 Free 플랜이고 결제 수단·유료 플랜이 없다는 조건에서만** 성립한다. 이 저장소에서는 계정 상태를 확인할 수 없다.

## 4. 로컬 실행

```bash
npm ci
npm run online:worker    # wrangler dev --local, http://127.0.0.1:8787, 상태는 .wrangler-state/
npm run dev              # http://127.0.0.1:5173/YachtLab/
# 브라우저: http://127.0.0.1:5173/YachtLab/?online-server=http://127.0.0.1:8787#online
```
`npm run online:server`(Phase 2 Node 서버)도 같은 주소·API로 계속 쓸 수 있다.

## 5. 실제 배포 전 필요한 설정 (승인 전 미실행)

1. **계정 확인(소유자):** Workers Free 플랜인지, 결제 수단·Workers Paid가 없는지, 기존 DO 네임스페이스가 없는지. 유료라면 DO 지출 한도와 사용량 알림을 먼저 설정.
2. **`worker/wrangler.toml`:** `ALLOWED_ORIGINS = "https://oyueo-mm.github.io"`로 교체(로컬 주소 제거). 서비스 주소를 정하고 `workers_dev`(기본 `*.workers.dev`) 또는 사용자 도메인 라우트 중 하나를 켠다. 변수 기본값(속도 제한·방 수·보존 기간) 검토.
3. **배포 명령(승인 후):** `npx wrangler login` → `npx wrangler deploy --config worker/wrangler.toml`. 처음 배포 시 마이그레이션 `v1`이 두 SQLite DO 클래스를 만든다. 클래스 이름 변경·삭제는 새 마이그레이션 태그가 필요하다.
4. **프런트:** GitHub Actions 빌드 변수 `VITE_ONLINE_SERVER_URL=https://<worker 주소>`(https만 허용). 설정 전까지 Pages의 온라인 대전은 "준비 중".
5. **운영:** Workers Logs/관측(현재 `observability.enabled = false`) 켤지 결정, 대시보드에서 일일 사용량 확인, 개인정보 고지(닉네임만 저장, 최대 48시간 보관).
6. **배포 후 확인:** 실제 엣지에서 두 기기 대전, 재접속, 알람 타이머, 정리 동작과 DO 지표(요청·duration·행 쓰기)를 위 추정치와 비교.

## 6. 남은 문제

- 실제 축출(hibernation) 시점·엣지 지연·동시 부하는 배포 전 검증 불가(로컬은 시뮬레이션).
- 분산된 다수 IP의 남용은 앱 내부 제한만으로 막기 어려움 → WAF 규칙 등 배포 설정 필요.
- 디렉터리 DO는 전역 단일 객체(방 생성·입장·소켓 연결마다 호출). 소규모에는 충분하지만 DO 1개당 초당 약 1,000요청 소프트 한도가 상한.
- 재대결·관전·3~8인 온라인 UI, 이벤트 로그 HMAC/앵커링은 후속.
- Phase 2에서 알려진 표시 한계(재접속 시 효과음 일괄 재생) 유지.
