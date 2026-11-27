# C3 전역 빠른 대전과 관전 · A6 인수인계

기준은 최신 main의 C2 병합본과 D-045다. 빠른 대전은 기존처럼 공개 관전 대상이다. 친구 대전은 참가자별 명시적 동의로 관전 범위를 결정한다. C0의 Worker 배포 보류 조건을 이어받는다. [C0 운영 점검](https://github.com/oyueo-mm/YachtLab/pull/112) · [C1 경제 연구](https://github.com/oyueo-mm/YachtLab/pull/113) · [C2 리뷰 엔진](https://github.com/oyueo-mm/YachtLab/pull/116)

## A6 클라이언트 계약

`useBackgroundMatch(server, onMatched)`는 App에 한 번 장착한다. 하위 UI는 `MatchController`를 받아 사용한다. `MatchPopup`은 최소 구현이며 `state`, `display`, `setDisplay("hidden" | "minimized" | "expanded")`, `start(name)`, `cancel()`, `reconnect()`가 표현 레이어의 진입점이다. 페이지 컴포넌트가 별도 소켓을 시작할 필요가 없다.

| 상태 | 전환 조건 |
| --- | --- |
| `idle → connecting` | 빠른 대전 시작 또는 같은 탭의 티켓 복구. 중복 클릭은 기존 요청을 사용한다. |
| `connecting / reconnecting → waiting` | 서버가 `queued{since,waiting}` 확인. 표시 시간의 기준은 `since`다. |
| `waiting → pairing` | 서버의 `check`에 브라우저가 자동 `ready` 응답하고, 허브가 후보 소켓의 응답을 확인해 방 할당 시작. 체크에서 실패한 상대는 제외하며 남은 대기자 순서를 유지한다. |
| `waiting / connecting → cancelling` | 취소 요청을 전송하거나 재접속 시 전달. 서버가 `cancelled`를 확인하면 `idle`. 이미 할당을 시작했으면 같은 배정 결과를 처리한다. |
| `matched → entering` | 서버의 `matched`를 받은 탭이 좌석을 저장하고 자동 이동. 여기서 `yachtlab-match-found`가 `{code, opponent}`로 한 번 발생하고 알림음을 재생한다. 상태 두 개는 한 렌더로 합쳐질 수 있다. |
| `entering → idle / error` | 룸 `welcome`이면 `entered()`. 치명 오류 또는 20초 동안 인증된 룸 입장 응답이 없으면 `entryFailed(message, room)`. 해당 좌석으로 재입장할 수 있다. |
| `* → error` | `DUPLICATE`, `SESSION_EXPIRED`, `EXPIRED`, `IN_MATCH`, `UNAVAILABLE`, `NETWORK`, `REPLACED`, `ENTRY_FAILED` 등. `NETWORK`는 남은 티켓으로 `reconnect()`. |

`offerAfterMs`는 오프라인 AI 안내의 UI 입력값이다. 최소 UI는 30초 후보를 사용하고, 안내를 따라가도 매칭은 계속된다. 자동 진입에는 카운트다운을 두지 않았다. 3초 지연은 A6 정책 후보로 남는다. 별도 수락/거절 요청은 없다. 서버 AI는 대기 시작 화면에서 접힌 별도 메뉴로 접근한다.

중단된 로컬 게임과 경제 화면은 같은 컴포넌트 인스턴스를 유지한다. 매칭 때문에 가려진 로컬 AI 작업은 취소하고 상태를 보존한 채 복귀할 때 재개한다. 경제 요청의 서버 결과와 요청 후 화면 상태를 유지한다. 리뷰는 모달을 내릴 때 C2 분석 취소·Worker 정리를 그대로 실행한다. 복귀 시 같은 리뷰와 선택한 행동 위치를 복원하고 완료 캐시를 재사용한다. 관전은 페이지 이탈 시 기존 소켓을 닫으며 기존 관전은 자동 재연결하지 않는다. 실제 새로고침은 티켓과 저장 좌석 복구만 지원한다.

## 서버와 구버전 호환성

- `GET /api/features`의 선택 플래그는 `backgroundMatch`, `activity`, `friendPublicSpectate`다. 기존 빠른 대전 플래그만 있으면 WebSocket 레거시 큐를 사용한다. 이 경우 전역 탐색은 가능하지만 v2 취소 확인·준비 확인·할당 경합 응답은 지원 범위가 기존 Worker 수준이다. `quickMatch`가 없는 Worker 및 로컬 Node 서버에서는 친구 대전 진입점을 사용한다. 새 현황 API는 플래그가 있을 때만 호출한다.
- `/ws/match`의 `queue`는 `name,ticket,device,session?,v?`를 받는다. `v:2`에서 서버 `check{id}`에 `ready{id,session?}`를 자동 응답한다. 연결이 끊긴 취소는 `cancel{v:2,ticket,session?}`로 재접속해 확인한다. 15초마다 `alive`, 미응답 45초 및 최대 대기 5분은 기존 기준이다. 사용자·기기 해시·티켓을 중복 검사하며, 기존 브라우저 저장소로 식별할 수 없는 게스트가 여러 모드에 접속하는 경우는 계정 수준 중복 방지를 적용할 수 없다.
- 방 할당 시작 전 허브가 시도 ID, 좌석 순서와 자격 증명을 기록한다. 디렉터리는 같은 ID에 같은 방 코드를 반환하고 룸은 서버가 제공한 동일 좌석 토큰으로 재시도를 검증한다. 허브는 두 결과와 대기 잠금 변경을 한 SQLite 트랜잭션에 반영한다. 결과와 미확정 시도는 최대 5분 동안 검색 가능하다. 룸 정리 알람과 디렉터리 보존 기한은 기존 값이다. 디렉터리가 새 경기의 회원 좌석을 예약하므로 친구·빠른 대전·서버 AI의 동시에 시작하는 경기는 충돌로 거절한다. 업데이트 이전부터 시작한 경기에 대한 회원 좌석 예약은 소급하지 않는다.
- `GET /api/spectate/rooms`는 공개된 경기의 `code,kind,status,participants,players,round,rounds,spectators,max`를 반환한다. `players`는 이름·점수·공개 장착 정보만 포함한다. 친구 대전의 `spectate{allow,visibility?}`는 참가 좌석 소켓에서 보낸다. `visibility`는 `private | invite | public`이고, 기존 `allow:true`는 링크 관전 동의로 매핑한다. `spectate` 응답은 `preferences`와 유효 범위 `visibility`를 제공한다. 한 명이 비공개면 관전이 꺼지고, 전원이 공개면 목록에 오른다. 나머지 전원 동의 조합에서는 토큰 링크로만 볼 수 있다.
- `POST /api/spectate/:code/watch`가 조회 시점에 룸에서 공개와 인원을 다시 검사해 `{code,key}`를 반환한다. `/ws/:code` 첫 프레임 `watch{key,since?}`는 복구에도 같은 권한 검증을 거친다. 토큰은 참가 인증 `hello{token}`에 사용할 수 없다. 친구 경기 종료와 공개 범위 축소는 기존 키와 관전자 소켓을 폐기한다. 친구 대전 기본 공개 정책은 미확정이며 기존 방에 명시적 공개 동의를 부여하지 않는다.
- `GET /api/activity`의 `ServerActivity`는 `asOf`(서버 Unix ms), `timezone:"UTC"`, `waiting`, `playing`(random/friend/ai), `privatePlaying`, `spectators`, `completedToday`, `yachtsToday`, `activeUsers`다. 모든 라이브 방의 이벤트를 관측하지 못한 경우 방·관전자 집계는 `null`이다. 활성 사용자는 게임 밖 활동까지 포함한 사이트 전체 계정·게스트 수를 의미하므로 `null`로 반환한다. 관전자 수의 단위는 권한을 얻은 연결이며 사용자 수와 합산하지 않는다. 대기는 허브의 생존 신호와 만료 조건을 충족한 대기 티켓이다.
- UTC 일자별 당일 완료는 정상 종료 이벤트의 경기 ID, 요트는 서버의 양수 `yacht` 점수 이벤트의 경기 ID·시퀀스로 중복 제거한다. 로컬 오프라인 경기, 몰수 종료 및 채점되지 않은 주사위 조합은 포함하지 않는다. Worker 버전 교체 이전에 전달되지 않은 이벤트와 전달 실패 후 룸이 정리된 경우에는 집계가 누락될 수 있다. 이 응답의 데이터는 운영 관측용이며 정산의 입력으로 쓰이지 않는다.

## 갱신과 Free 플랜 영향

새 Worker 리소스나 바인딩은 없다. 대기 중에는 기존 15초 WS 생존 신호를 쓰며 대기 티켓을 SQLite에 쓰지 않는다. v2 후보당 브라우저별 자동 응답 한 건과, 회원 후보의 세션 재검증 한 건이 추가된다. 새 배정의 핵심 SQLite 쓰기는 두 명 기준으로 허브 시도 1행, 식별자 잠금 최대 6행의 초기 및 확정 쓰기, 수령 정보 4행, 디렉터리 배정 1행 및 회원 좌석 최대 2행과 종료 정리다. 기존 경기당 약 110행 수준의 명령과 로그를 보존한다. 완료와 유효 요트는 관측 값마다 최대 한 행을 추가한다.

관전 화면이 보일 때만 기존 목록 조회 10초(응답 캐시 5초)와 현황 조회 30초(응답 캐시 15초)를 사용한다. 연결한 관전자는 기존 WS로 갱신된다. 방은 상태/공개 범위/관전자 수 변경 시 익명 집계를 보내며, 공개 목록은 라운드·점수·관전자 수가 바뀔 때 갱신한다. 올바른 권한은 캐시가 아닌 룸에서 확인한다. 현황 조회 캐시가 비어 있으면 디렉터리와 허브에 RPC를 각각 한 건 호출한다. 운영 요청량, CPU, 실기기 절전 제한은 측정되지 않았다.

## 경계

단일 방의 실제 경기 규칙·보상·원장은 기존 엔진 및 정산을 사용한다. 서버 큐에서 양측 연결을 확인해도 DNS·네트워크 변경 등으로 룸 진입이 실패할 수 있다. 이 경우 좌석 재입장과 기존 온라인 재접속 유예를 사용한다. 브라우저 종료, OS 중지 동안 연결 유지와 새로고침 후 로컬 게임 복원은 지원 계약에 포함하지 않는다. 최종 팝업 및 관전 목록 디자인은 A6 범위다.
