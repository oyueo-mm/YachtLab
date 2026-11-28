# 공통 보상 지급 계약 (C5 → 05·06 담당, 2026-11-28)

> 구현: `worker/src/grants.ts` (`RewardGrants`, `creditAdminClaim`), `worker/src/retention.ts` (`RetentionStore`), 원장 기록 `EconomyStore.grantCredit`, 정책 `src/economy/retention/policy.ts` (`APPROVED_POLICY` = C5-CORE@1), 교환 코드 검사 `src/economy/retention/codes.ts`.
> 테스트: `tests/reward-grants.test.ts`, `tests/retention-worker.test.ts`, `tests/retention-worker-e2e.test.ts`(wrangler), `tests/retention-policy.test.ts`, `tests/sec1-economy.test.ts`, `tests/ui/rewards.spec.ts`.
> **상태(2026-11-28):** C5-CORE 채택(D-C5-2), Worker 연동 구현 완료. 운영 플래그 `RETENTION`은 기본 off다. 지급 가능한 출처는 **출석·연속 활동·주간 연승**뿐이다. 관리자·제안·일일 콘텐츠·교환 코드 금액은 미승인이라 `SOURCE_DISABLED`다. 통합 안내: [INTEGRATION-C5.md](./INTEGRATION-C5.md).

## 1. 누가 무엇을 부르나

| 출처(`source`) | 호출 주체 | 거래 ID(txId) 규칙 | 방식 | 1회 상한(코인/보석/아이템) |
|---|---|---|---|---|
| `attendance` ✅ 승인 | 출석 수령 API (C5) | `att:<주기>:<n>` (`claimAttendance`) | direct | 200 / 10 / 0 |
| `daily-play` ⏸ 보류 | 경기 정산 (C5) | `dp:<KST일>:<k>` · `dp:<KST일>:done` | direct | 50 / 0 / 0 |
| `daily-content` ⏸ 금액 미승인 | **05 LIVE-1 일일 콘텐츠** | `dc:<콘텐츠ID>:<KST일>` (콘텐츠·날짜당 1회) | direct | 100 / 5 / 0 |
| `activity-streak` ✅ 승인 | 경기 정산·LIVE-1 완료 보고 (C5) | `act:m<일수>` · `act:r:<KST일>` | direct | 1000 / 30 / 1 |
| `weekly-streak` ✅ 승인 | 경기 정산 (C5) | `ws:<주>:<단계>` | direct | 100 / 5 / 0 |
| `return` ⏸ 보류 | (향후) | `ret:<KST일>` | direct | 300 / 10 / 0 |
| `redeem-code` ⏸ 미승인 | 교환 코드 API(ADMIN-1 AdminHub 예약 후) | `code:<코드ID>` | direct | 1000 / 50 / 1 |
| `event` ⏸ 미승인 | 이벤트 정산 | `e:<이벤트ID>` 또는 `ev:<이벤트ID>:<단계>` | direct/inbox | 1000 / 50 / 1 |
| `operator` ⏸ 미승인 | **06 ADMIN-1 운영자 도구**(운영자 인증) | `op:<캠페인ID>` (사용자·캠페인당 1회) | inbox 권장 | 5000 / 200 / 3 |
| `suggestion` ⏸ 미승인 | **06 ADMIN-1 제안 채택** | `sug:<제안ID>` | inbox | 2000 / 100 / 1 |
| `compensation` ⏸ 미승인 | 06 장애 보상 | `comp:<규칙버전>:<범위>` | inbox | 10000 / 600 / 3 |

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

오류 코드: `SOURCE_DISABLED`(승인·활성화되지 않은 출처), `TX_ID`, `SOURCE`, `FORBIDDEN`, `ACTOR`, `AMOUNT`, `EMPTY`, `LIMIT`, `ITEM`, `POLICY`, `LABEL`, `DELIVERY`, `TX_CONFLICT`(같은 txId·다른 내용), `NO_ECONOMY`(경제를 쓴 적 없는 계정 — 가입 보상 경로가 먼저), `EXPIRED`, `REVOKED`, `NOT_FOUND`, `NOT_REVOCABLE`.

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

## 6. 05 LIVE-1 일일 콘텐츠 담당에게

- 서버가 판정한 완료만 지급한다. 클라이언트가 보고한 점수·완료는 지급 근거가 아니다(SEC-1 §8, D-101).
- 완료 1회당 `issue(userId, { txId: "dc:<콘텐츠ID>:<KST일>", source: "daily-content", ... })`를 부른다. KST 날짜는 `economyDay(now)`(서버 시각)로 계산한다.
- 연속 활동(승인됨): 공식 오늘의 요트 완료를 서버가 판정한 직후 계정 객체 RPC `dailyContentDone({ kind: "daily.official.completed", at })`를 부른다. `RetentionStore.onDailyContent`가 활동일 기록과 이정표 지급을 한 트랜잭션에서 처리한다. 퍼즐 답안·시작은 활동이 아니다.
- 일일 콘텐츠 금액은 C5 경제 연구의 발행 예산 안에서 정한다. 승인 전 기본 0이다.

## 7. 06 ADMIN-1 운영·제안·보상함 담당에게

- 운영자 지급은 **관리자 보안 조건을 갖추기 전에는 연결하지 않는다**: 서버 측 역할 검사, 읽기·쓰기 권한 분리, 모든 쓰기의 감사 로그(행위자·대상·사유·전후 값), 관리자 세션 분리·재인증(C4 SEC-06, SEC-1 §7).
- 캠페인은 `op:<캠페인ID>`(사용자당 1회)이고 inbox + 만료로 보낸다. 잘못 보낸 경우 미수령분만 `revoke`할 수 있다. 수령된 지급은 되돌리지 않는다.
- 제안 채택 보상은 `sug:<제안ID>`로 제안당 1회이고, 제안 ID는 05가 발급하는 불변 ID다.
- 보상함 화면에는 `inbox(now)`(수령 가능), `history()`(지난 지급)을 쓴다. 보상함 목록은 계정 객체 안에만 있다.

## 8. 구현 상태

- [x] 원장 기록 경로 단일화: `RewardGrants` → `EconomyStore.grantCredit` → `post`(중복 구현 제거)
- [x] 계정 DO 초기화에 `grants.init()`·`retention.init()`(추가형 표 `grant_tx`·`retention`, 롤백 안전)
- [x] API: `GET /api/me/rewards`, `POST /api/me/rewards/attendance`, `POST /api/me/rewards/claim`, `POST /api/me/rewards/redeem`(지금은 `REDEEM_OFF`)
- [x] 경기 정산 트랜잭션 안 연속 활동·주간 연승(서버 검증 기록만), 결과 영수증에 지급 줄 추가
- [x] 운영 지표 `grant.<source>`·`.coins`·`.gems`, 관리자 원장 검사에 지급 기록 검증 포함
- [ ] (별도 승인) 운영 `RETENTION="on"`, 출처별 활성화(관리자·제안·일일 콘텐츠·교환 코드), ADMIN-1 우편함 보상의 보상함 통합(INTEGRATION §3)
