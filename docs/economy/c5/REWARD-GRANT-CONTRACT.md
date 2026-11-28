# 공통 보상 지급 계약 (C5 → 05·06 담당, 2026-11-28)

> 구현: `worker/src/grants.ts` (`RewardGrants`), 재방문 정책 `src/economy/retention/policy.ts`, 교환 코드 `src/economy/retention/codes.ts`. 테스트: `tests/reward-grants.test.ts`, `tests/retention-policy.test.ts`, `tests/sec1-economy.test.ts`.
> **상태: 비활성 프로토타입.** `worker/src/index.ts`는 아직 이 모듈을 가져오지 않는다(Worker 번들 미포함). 금액은 후보이고 승인 전이다(D-C5-1). 연구 근거는 [C5 연구](../C5-RETENTION-RESEARCH.md)에 있다.

## 1. 누가 무엇을 부르나

| 출처(`source`) | 호출 주체 | 거래 ID(txId) 규칙 | 방식 | 1회 상한(코인/보석/아이템) |
|---|---|---|---|---|
| `attendance` | 출석 수령 API (C5) | `att:<주기>:<n>` (`claimAttendance`) | direct | 200 / 10 / 0 |
| `daily-play` | 경기 정산 (C5) | `dp:<KST일>:<k>` · `dp:<KST일>:done` | direct | 50 / 0 / 0 |
| `daily-content` | **06 일일 콘텐츠** | `dc:<콘텐츠ID>:<KST일>` (콘텐츠·날짜당 1회) | direct | 100 / 5 / 0 |
| `activity-streak` | 경기 정산·06 완료 보고 (C5) | `act:m<일수>` · `act:r:<KST일>` | direct | 1000 / 30 / 1 |
| `weekly-streak` | 경기 정산 (C5) | `ws:<주>:<단계>` | direct | 100 / 5 / 0 |
| `return` | (향후) | `ret:<KST일>` | direct | 300 / 10 / 0 |
| `redeem-code` | 교환 코드 API | `code:<코드ID>` | direct | 1000 / 50 / 1 |
| `event` | 이벤트 정산 | `e:<이벤트ID>` 또는 `ev:<이벤트ID>:<단계>` | direct/inbox | 1000 / 50 / 1 |
| `operator` | **05 운영자 도구**(운영자 인증) | `op:<캠페인ID>` (사용자·캠페인당 1회) | inbox 권장 | 5000 / 200 / 3 |
| `suggestion` | **05 제안 채택** | `sug:<제안ID>` | inbox | 2000 / 100 / 1 |
| `compensation` | 05 장애 보상 | `comp:<규칙버전>:<범위>` | inbox | 10000 / 600 / 3 |

- txId는 `[A-Za-z0-9:._-]{4,96}`이고, **결정적으로 만든다**. 같은 사건은 몇 번을 재시도해도 같은 txId가 나와야 한다. 난수 ID를 쓰지 않는다.
- 출처별 상한은 실수·도구 오류의 한도다. 상한보다 큰 지급은 한 행으로 처리하지 않고, 검토된 캠페인 여러 개로 나눈다.
- `operator`·`suggestion`·`compensation`은 `issue(..., { operator: true })`이고 `actor = "admin:<운영자ID>"`다. 그 밖의 출처는 `actor = "system"`이다. 클라이언트 요청 경로는 운영자 출처를 쓸 수 없다(`FORBIDDEN`).

## 2. 인터페이스

```ts
type GrantRequest = {
  txId: string;              // 멱등 키
  source: GrantSource;
  coins: number; gems: number;   // 0 이상의 정수, 둘 다 0이면 아이템이 있어야 함
  items?: string[];          // 카탈로그 ID. 기본·은퇴·업적 전용 아이템 거부
  policyVersion: string;     // 금액을 정한 정책/캠페인 버전 → 원장 config 칸
  label: string;             // 사용자 표시(≤ 80자)
  actor: "system" | `admin:${string}`;
  delivery: "direct" | "inbox";
  expiresAt?: number | null; // inbox만
  ref?: string;              // 제안 ID·캠페인 ID 등 참고값(멱등에는 쓰지 않음)
};
grants.issue(userId, req, now, { operator? })   // → { ok, duplicate, record, wallet } | { ok:false, code, message }
grants.claim(txId, now) · grants.claimAll(now)  // 보상함 수령
grants.revoke(txId, "admin:<id>", now)          // 미수령 보상함만
grants.expire(now) · grants.inbox(now) · grants.history(limit, source?)
grants.verify()                                 // 지급 기록 ↔ 원장 대조 (EconomyStore.verify()와 함께)
```

오류 코드: `TX_ID`, `SOURCE`, `FORBIDDEN`, `ACTOR`, `AMOUNT`, `EMPTY`, `LIMIT`, `ITEM`, `POLICY`, `LABEL`, `DELIVERY`, `TX_CONFLICT`(같은 txId·다른 내용), `NO_ECONOMY`(경제를 쓴 적 없는 계정 — 가입 보상 경로가 먼저), `EXPIRED`, `REVOKED`, `NOT_FOUND`, `NOT_REVOCABLE`.

## 3. 저장과 원장

- **기존 원장 재사용**: 지급 1건은 `ledger`의 `g:<txId>` 행 1개다. `kind = source`, `config = policyVersion`, `funding = 'play'`이고, 누적 잔액 칸은 기존 그대로라 `EconomyStore.verify()`가 계속 성립한다. 아이템은 `inventory`에 `via = grant:<source>`로 들어간다.
- **지급 기록** `grant_tx`: txId · 출처 · 대상 사용자 · 금액 · 아이템 · 정책 버전 · 표시 문구 · 행위자 · 방식 · 상태(`granted / inboxed / claimed / expired / revoked`) · 내용 지문 · 생성/변경 시각 · 만료 · 원장 행 ID · 참고값 · 건너뛴 아이템.
- 상태 전이: direct는 `granted`로 끝난다. inbox는 `inboxed → claimed | expired | revoked`이고, 원장 행은 `claimed` 때만 생긴다.
- 이미 가진 아이템은 다시 넣지 않고 `skippedItems`에 기록한다. 대체 지급은 없다. 대체가 필요하면 정책에서 정해 별도 거래로 처리한다.

## 4. 보장

| 요구 | 보장 방법 | 테스트 |
|---|---|---|
| 중복 지급 방지·멱등 | txId 기본키 + 내용 지문. 같은 내용 → `duplicate`, 다른 내용 → `TX_CONFLICT` | `reward-grants` "같은 거래 ID의 재시도" |
| 원자성·실패 복구 | 지급 기록·원장·잔액·아이템이 한 트랜잭션. 예외 시 전부 되돌림 → 같은 txId로 재시도 | "실패한 지급은 아무것도 남기지 않고" |
| 동시성 | 계정 DO 직렬 실행. 두 기기가 같은 날 출석해도 같은 txId → 1회 | `sec1-economy` "두 기기가 같은 날 출석" |
| 재시도 | 응답 유실 시 같은 txId로 다시 호출 → 원래 기록 반환 | 위 동일 |
| 지급 이력 검증 | `grants.verify()`: 지급됨/수령됨 ↔ `g:` 원장 행 금액·출처·정책 버전 일치, 지급 기록 없는 `g:` 행 없음, 미수령 행에 원장 없음 | "검증은 … 찾아낸다" |
| 관리자 원장 우회 금지 | 잔액 설정 API 없음. 운영자는 `issue`(양수·상한·사유·행위자)와 미수령 `revoke`만 가능. 지급된 거래는 수정·삭제 없음 | "클라이언트·시스템 경로는 운영자 출처를 쓸 수 없고" |
| 기존 경제와 공존 | 지급 뒤 구매·강화·뽑기가 같은 원장 위에서 동작 | "지급 후에도 기존 구매·강화가 그대로" |

## 5. 교환 코드

- 코드 원문은 저장소·번들·로그에 두지 않는다. 저장하는 것은 `SHA-256(normalizeCode(code))`뿐이다. 정규화는 대문자화, 공백·하이픈 제거, `[A-Z0-9]`만 남기기다.
- 계정당 1회는 txId `code:<코드ID>`가 보장한다. 기간·가입 시점 조건은 `checkCode()`로 확인한다.
- **총 수량 제한**(예: 선착순 1,000명)은 전역 객체가 필요하다. 그래서 다음 2단계로 처리한다.
  1. 전역 코드 객체(Hub 또는 전용 DO)에 `reserve(codeId, userId)`를 부른다. 사용자 ID로 멱등이고 남은 수량을 원자적으로 줄인다.
  2. 계정 객체에서 `issue(code:<id>)`를 부른다.

  2단계가 실패하면 같은 요청으로 재시도한다. 예약만 되고 지급이 안 된 건은 사용자 재시도나 알람 재처리로 지급한다. 예약 취소는 하지 않는다(초과 지급 방지가 우선).
- 오류 문구는 "없는 코드"와 "사용할 수 없는 코드" 정도로 균일하게 둔다. 시도는 계정·IP별로 제한한다(SEC-1 §8).

## 6. 06 일일 콘텐츠 담당에게

- 서버가 판정한 완료만 지급한다. 클라이언트가 보고한 점수·완료는 지급 근거가 아니다(SEC-1 §8, D-101).
- 완료 1회당 `issue(userId, { txId: "dc:<콘텐츠ID>:<KST일>", source: "daily-content", ... })`를 부른다. KST 날짜는 `economyDay(now)`(서버 시각)로 계산한다.
- 연속 활동에 포함하려면 같은 트랜잭션에서 `markActiveDay(state, policy, now)`를 부르고 나온 `RetentionGrant`를 그대로 `issue`한다.
- 일일 콘텐츠 금액은 C5 경제 연구의 발행 예산 안에서 정한다. 승인 전 기본 0이다.

## 7. 05 운영·제안·보상함 담당에게

- 운영자 지급은 **관리자 보안 조건을 갖추기 전에는 연결하지 않는다**: 서버 측 역할 검사, 읽기·쓰기 권한 분리, 모든 쓰기의 감사 로그(행위자·대상·사유·전후 값), 관리자 세션 분리·재인증(C4 SEC-06, SEC-1 §7).
- 캠페인은 `op:<캠페인ID>`(사용자당 1회)이고 inbox + 만료로 보낸다. 잘못 보낸 경우 미수령분만 `revoke`할 수 있다. 수령된 지급은 되돌리지 않는다.
- 제안 채택 보상은 `sug:<제안ID>`로 제안당 1회이고, 제안 ID는 05가 발급하는 불변 ID다.
- 보상함 화면에는 `inbox(now)`(수령 가능), `history()`(지난 지급)을 쓴다. 보상함 목록은 계정 객체 안에만 있다.

## 8. 활성화 전 남은 일 (승인 후)

1. `RewardGrants.credit`을 `EconomyStore` 안으로 옮겨 원장 기록 경로를 하나로 만든다. 지금은 같은 SQL을 따르는 사본이고, 상호 운용 테스트로 고정해 두었다.
2. 계정 DO 초기화에 `grants.init()`을 추가한다(추가형 표, 롤백 안전).
3. API를 연다: `POST /api/me/attendance/claim`, `GET /api/me/rewards/inbox`, `POST /api/me/rewards/claim`(txId 또는 all), `POST /api/me/codes/redeem`(시도 제한). 운영자 API는 §7 조건을 갖춘 뒤에 연다.
4. 운영 지표: `grant.<source>` 발행량, 보상함 미수령 잔고, `econ.maxCoinsOneAccount` 경보 기준 갱신.
5. `worker/src/economy.ts`·경제 정책 변경은 D-100 보호 입력이므로 수동 고위험 배포다.
