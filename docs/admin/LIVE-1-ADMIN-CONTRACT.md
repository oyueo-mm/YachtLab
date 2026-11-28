# LIVE-1 (#142) 관리자 API 통일 계약 (ADMIN-1 → LIVE-1, 2026-11-28)

> 상태: **제안 + ADMIN-1 쪽 구현 완료**(`AdminExtensionRoute`, 권한 `content.write`, 테스트 `tests/admin-followup.test.ts` §8). #142 브랜치는 수정하지 않았습니다. LIVE-1 담당이 반영하고 INT-1이 통합합니다.

## 1. 왜 바꾸나

#142는 `GET /api/admin/daily`(보고서)와 `POST /api/admin/daily/puzzle`(문제 내리기·되살리기)를 공유 `ADMIN_TOKEN`으로 보호합니다. 이 토큰에는 사용자 구분·역할·만료·감사·쓰기 스위치가 없어서, SEC-1이 출시 차단 조건으로 정한 "서버 측 역할 검사, 읽기·쓰기 분리, 모든 관리자 쓰기의 감사"를 충족하지 못합니다. ADMIN-1 후속 작업에서 레거시 토큰 경로는 **코드에 고정된 GET 2개**(`metrics`, `ledger`)로 제한했으므로, 통합 후에는 #142의 토큰 라우트가 **동작하지 않습니다**(404).

## 2. 계약

```ts
// worker/src/admin/api.ts
type AdminExtensionRoute = {
  method: "GET" | "POST";
  path: RegExp;                 // 전체 경로
  permission: Permission;       // roles.ts
  write: boolean;               // true → ADMIN_WRITES=on 필요 + 항상 감사
  highRisk?: boolean;           // true → Google 재인증 10분 이내
  auditRead?: boolean;          // 민감 조회 감사
  action: string;               // 감사 이름 "daily.puzzle"
  handle(ctx: { url; match; body; actor; now }): Promise<{ status; body; target?; detail? }>;
};
```

라우터(`handleAdminRoute`)가 처리 전에 수행하는 일:
1. `a1.` 관리자 세션 확인(유휴·절대 만료)
2. `ADMIN_ACCOUNTS`에서 역할 재조회
3. 권한 확인(실패 시 403과 감사)
4. 쓰기 스위치 확인
5. 재인증 시간 확인
6. 본문 JSON 검증(16KB)
7. 쓰기는 결과와 무관하게 감사 기록(행위자, 대상, 결과, 상세)

비관리자와 세션이 없는 요청은 같은 404를 받습니다.

## 3. LIVE-1 라우트 매핑

| 라우트 | 권한 | write | highRisk | 감사 action | 비고 |
|---|---|---|---|---|---|
| `GET /api/admin/daily?date=` | `stats.read` | false | – | (조회, 미감사) | `DailyAdminReport` — 계정 ID·닉네임 없음 확인됨 |
| `POST /api/admin/daily/puzzle {date, puzzleId, disabled}` | `content.write` (operator·owner) | true | false | `daily.puzzle` (target=puzzleId, detail={date, disabled}) | 되살리기도 같은 라우트 |

등록 위치(통합 시): `worker/src/index.ts`의 `engagement()` 백엔드에 `extensions: dailyAdminRoutes(deps)`를 추가합니다. `dailyAdminRoutes`는 `daily-api.ts`가 내보내고, 기존 `dailyAdminReport`와 퍼즐 플래그 함수를 `handle`로 감쌉니다.

## 4. LIVE-1 담당에게 요청 (#142)

- [ ] `/api/admin/daily*`의 `ADMIN_TOKEN` 검사를 제거하고 위 매핑으로 등록합니다(`dailyAdminRoutes` 내보내기).
- [ ] `docs/context/DAILY-LIVE-1.md` §4 API 표의 인증 칸을 "관리자 세션(`stats.read` / `content.write`)"으로 바꿉니다.
- [ ] 문제 내리기 응답에 `target`(puzzleId)과 `detail`(date, disabled)을 돌려줘 감사에 남게 합니다.
- [ ] 운영 콘솔 화면(일일 보고서 메뉴)은 ADMIN-1 콘솔의 "통계" 그룹에 추가합니다. INT-1 통합 뒤 06이 진행합니다.

## 5. 일일 콘텐츠 보상 (C5 계약 §6과의 관계)

LIVE-1은 현재 보상이 없습니다(`NO_DAILY_REWARDS`). 일일 콘텐츠 보상(`dc:<콘텐츠ID>:<KST일>`)은 C5 RewardGrants의 **system** 지급이고 관리자 경로가 아니므로, 이 계약의 대상이 아닙니다. 날짜 경계는 관리자 활동 집계와 같이 KST입니다.
