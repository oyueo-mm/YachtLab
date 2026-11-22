# YachtLab Online v0.1 — Phase 1: 서버 권한형 게임 엔진

> 상태: **구현·단위 테스트 완료, 미배포.** 네트워크 전송·저장소·인증·UI는 이후 단계. Cloudflare 등 외부 리소스는 생성하지 않았다.

## 목표와 범위

| 포함 (Phase 1) | 제외 (후속 단계) |
|---|---|
| 순수 TypeScript 경기 엔진 `src/online/` | WebSocket/HTTP 전송, 방 목록·매칭 |
| 명령 검증·거부 코드·낙관적 동시성·멱등성 | 저장소 어댑터(예: Durable Object storage) |
| CSPRNG 주사위, 이벤트 로그·재구성·감사 | 계정/인증, 재접속 토큰 |
| 플레이어별 공개 뷰, 턴 제한 시간·기권 | 온라인 UI, 관전 UI, AI 좌석 |

기존 로컬 게임(`src/engine.ts`, `src/multi-engine.ts`), AI 연구 코드, 리플레이, 배포 번들은 **변경하지 않았다**. 온라인 모듈은 앱 번들에서 import되지 않으므로 Pages 배포 결과물에도 영향이 없다.

## 구조

```
src/online/
  protocol.ts      와이어 타입(명령·이벤트·뷰·오류 코드), 신뢰할 수 없는 JSON 검증 parseCommand
  dice-source.ts   DiceSource 인터페이스, Web Crypto CSPRNG(거부 샘플링), 테스트 전용 seeded/scripted
  server-engine.ts createOnlineMatch / applyCommand / applyEvent / rebuildFromEvents / viewFor
  match-host.ts    경기 1개를 감싸는 인메모리 호스트(향후 전송·저장 어댑터가 감쌀 경계)
tests/online-engine.test.ts
```

### 핵심 설계

1. **규칙 단일화** — 점수 계산은 `engine.ts`의 `score/total/upper/bonus`를 그대로 재사용한다. 12칸 Nintendo-style Yacht Dice(D-001)가 로컬·AI·온라인에서 동일하다.
2. **이벤트 소싱** — `applyCommand`는 명령을 검증해 이벤트를 만들고, 상태 변경은 오직 `applyEvent` 리듀서로만 일어난다. `version = log.length`이며 `rebuildFromEvents(log)`가 상태를 정확히 재구성하고, 점수 계산·고정 주사위·순서 위변조를 검출한다.
3. **순수·런타임 무관** — 엔진은 시계·타이머·I/O가 없다. 호스트가 `now`와 `DiceSource`를 주입한다. 어떤 서버 런타임에도 이식할 수 있고 테스트가 결정적이다.
4. **숨김 정보 없음** — 매치 상태에 seed/PRNG 상태를 **저장하지 않는다**. 주사위는 호출 시점에 CSPRNG에서 뽑으므로 저장된 스냅샷·이벤트·뷰로 미래 눈을 예측할 수 없다(D-004 강화, D-010).
5. **신원 바인딩** — `parseCommand(raw, authenticatedPlayerId)`는 페이로드의 `playerId`를 무시하고 인증된 연결의 ID를 사용한다.
6. **멱등성·동시성** — `(playerId, commandId)` 중복은 상태 변경·주사위 소비 없이 `duplicate: true`를 반환(최근 256개). `expectedVersion` 불일치는 `STALE_VERSION`.

### 경기 수명주기

`lobby` → (`join`/`leave`, 방장 `start`, 2~8명) → `playing` → `finished`

| 명령 | 조건 | 결과 이벤트 |
|---|---|---|
| `join {name}` | lobby, 빈 좌석 | `playerJoined` (가장 낮은 빈 좌석) |
| `leave` | lobby | `playerLeft` (방장은 남은 가장 먼저 참가한 사람으로 승계) |
| `start` | 방장, 2명 이상 | `matchStarted`, `turnStarted` (좌석 순) |
| `roll {keep}` | 내 차례, 굴림 < 3, 첫 굴림은 keep 없음, 최소 1개는 재굴림 | `diceRolled` |
| `score {category}` | 내 차례, 1회 이상 굴림, 빈 칸 | `categoryScored` → `turnStarted` 또는 `matchFinished` |
| `resign` | playing, 활성 참가자 | `playerForfeited(resign)` (+ 차례 넘김/종료) |
| `claimTimeout` | 참가자, 현재 턴 `deadline` 경과 | `playerForfeited(timeout)` + 차례 넘김/종료 |

- `roll`은 "고정 위치 + 굴림"을 원자적으로 처리해 hold/roll 사이 경쟁 조건을 없앴다.
- 기권(시간 초과 포함) 플레이어는 이후 차례에서 제외되고 순위는 활성 플레이어 뒤. 활성 플레이어가 1명 이하가 되면 즉시 종료.
- 점수는 서버가 계산하며, 뷰의 `legal.scores`로 현재 플레이어에게만 미리보기를 제공한다.

### 오류 코드

`INVALID_COMMAND, STALE_VERSION, NOT_IN_MATCH, ALREADY_JOINED, MATCH_FULL, WRONG_PHASE, NOT_HOST, NOT_ENOUGH_PLAYERS, NOT_YOUR_TURN, MUST_ROLL_FIRST, NO_ROLLS_LEFT, INVALID_KEEP, CATEGORY_TAKEN, TIMEOUT_NOT_REACHED, NO_DEADLINE`

거부된 명령은 상태를 바꾸지 않는다. 잘못된 `DiceSource`(1~6 밖) 같은 **서버 내부 결함**은 거부가 아니라 예외로 드러낸다.

## 검증 (tests/online-engine.test.ts, 18개)

- 2인 전체 경기 24턴 완주, 총점·승자 = `engine.total` 기준, 로그 재구성 및 JSON 왕복 일치
- 3인 좌석 순 라운드 로빈, 고정 주사위 유지와 요트 50점
- 모든 거부 코드와 거부 시 상태 불변, 멱등성(주사위 미소비), 플레이어별 commandId 분리
- 4인 경기의 시간 초과·기권·순위, 1인 남으면 종료, 방장 승계·좌석 재사용
- 뷰에 `recentCommands/seed/rng/commandId` 없음, 현재 플레이어만 `legal`, 남은 시간 계산
- 로그 위변조(점수/고정 주사위/순서) 검출, 신뢰할 수 없는 JSON 17종 거부, 페이로드 `playerId` 무시
- 거부 샘플링의 정확한 경계, 플랫폼 CSPRNG 60,000회 카이제곱(df=5, 임계 25.7)

## 다음 단계 제안 (미구현)

1. 전송 계층: 방 하나당 단일 직렬 처리 인스턴스, 명령 수신 → `OnlineMatchHost.handle` → 모든 연결에 새 이벤트 브로드캐스트(`viewFor(..., sinceSeq)`).
2. 저장: 이벤트 로그 append + 주기적 스냅샷, 복구 시 `rebuildFromEvents`로 감사.
3. 턴 타이머: 서버 알람이 마감 시 `claimTimeout`을 시스템 명령으로 실행(현재는 참가자 요청형).
4. 인증·재접속 토큰, 남용 방지(명령 빈도 제한), 온라인 UI.
5. 선택: commit-reveal 방식 주사위로 서버 운영자 조작 가능성까지 감사.

플랫폼 리소스 생성·유료 기능·실제 배포는 별도 승인 후 진행한다.
