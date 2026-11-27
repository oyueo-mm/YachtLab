# A4 서버 계약 후보 (2026-11-27) — 제안만, 구현·Worker 변경 없음

> A4(모바일·프로필·친구 UX)가 필요로 하지만 **현재 Worker API로는 안전하게 할 수 없는** 것들. 친구 API와 계정 보안은 C4.2 담당이라 A4는 Worker를 바꾸지 않았다. 아래는 계약 후보이며, 클라이언트는 현재 API로 최대한 동작하도록 어댑터 뒤에 두었다.

## 1. 프로필/계정 ID로 친구 요청 (가장 중요)
**문제:** 친구 API는 **친구 코드**(`YL` + 8자 무작위)로만 사람을 가리킨다. 경기 중 상대·서버 기록·`members`는 **계정 ID**(`userId`)로만 안다. 친구 코드는 계정 ID에서 유도되지 않고 공개 프로필(`GET /api/profiles/:userId`)에도 없다. 또한 친구 코드는 그 사람이 **친구 API를 처음 쓸 때**(`GET /api/me/friends`) 생성·색인되어, 한 번도 친구 화면/API를 쓰지 않은 사람은 검색에도 나오지 않는다(`/api/me/inbox`는 등록하지 않는다).

**A4의 현재 우회(Worker 무변경):** 상대 공개 프로필 → **정확한 닉네임 검색**(`friends/search`) → 닉네임이 같은 사람이 여럿이면 `friends/profile`의 공개 수치(가입 시각·승/패/무/최고점)가 일치하는 **한 명만** 인정 → 구분 못 하면 `unresolved`(아무것도 보내지 않고 "친구 코드로 추가" 안내). 로그인한 클라이언트는 세션당 한 번 `GET /api/me/friends`를 읽어 **자기 코드를 등록**한다(`ensureSelfRegistered`). 한계: 앱을 연 적 없는 회원은 찾을 수 없음, 동명이인 중 수치까지 같으면 구분 불가, 검색·프로필 호출이 늘어남(속도 제한 `friends/request` 10회).

**후보 A (권장):** `GET /api/me/friends/relation?userId=…` → `{ relation: "self"|"friend"|"incoming"|"outgoing"|"blocked"|"none", code?, nickname }` (+ 상대가 나를 차단한 경우는 지금처럼 `none`과 구분 불가하게).
**후보 B:** `POST /api/me/friends/request { userId }`(코드 대신 계정 ID, 서버가 코드로 변환). 응답은 기존과 같은 `sent|friends`, 차단·중복·한도 규칙 그대로.
**후보 C:** 계정 생성(로그인) 시 친구 코드를 자동 등록해 검색 가능하게(위 "처음 쓸 때" 문제 제거).
보안 메모: 계정 ID로 친구 요청을 허용해도 열거(enumeration) 위험은 `members`(방 안 상대)·서버 기록에 있는 ID로 제한하면 늘지 않는다. 구현 시 C4.2의 친구 관계 보안 수정과 함께 설계.

## 2. 대표 업적 서버 저장
**현재:** 이 기기 `localStorage`(`yachtlab.profile-pins.v1`), 최대 3개, 프로필 화면에서만 보임. `PinStore`(`load`/`save`) 인터페이스 뒤에 있어 서버 저장소를 바꿔 끼우면 UI는 그대로.
**후보:** `PUT /api/me/profile/pins { ids: string[] }`(≤3, 서버가 달성 목록으로 검증, 숨김 업적 허용 여부 결정 필요), `GET /api/me/economy` 스냅샷과 공개 프로필(`/api/profiles/:id`, `/api/me/friends/profile`)에 `pins: string[]` 포함. 응답에 라벨이 아니라 **업적 ID**만(라벨은 클라이언트 `achievementById`). 계정 삭제 시 함께 삭제. 다른 사람에게 보이게 하는 범위(전체/친구만)는 정책 결정(C4).
**미리보기(구현됨):** 프로필의 3칸 슬롯이 "이 기기에 저장돼요 · 다른 사람에게 보이게 하는 기능은 준비 중"으로 안내한다.

## 3. 그 밖의 메모
- 최근 대전 상대 목록은 `GET /api/me/records`(서버 검증 기록의 `opponent.userId`, 회원 상대만)에서 만든다. 손님·AI는 계정이 없어 친구 추가 대상이 아니다. 별도 API 불필요.
- A3(경기 종료 화면)는 `src/social/FriendRequestButton.tsx`를 그대로 import해 `userId`만 넘기면 같은 동작(상태 표시·중복 방지·차단 존중)을 쓴다.
