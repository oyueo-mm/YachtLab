# ADM-1 — 관리자 실제 Google 재인증 검증 절차 (2026-11-28, SEC-1 2차 감사 후속)

> **상태: 분석·절차만.** 운영 관리자 계정 등록(`ADMIN_ACCOUNTS`), 운영 인증 설정 변경, 실제 관리자 쓰기(`ADMIN_WRITES`) 활성화는 하지 않았다.
> 관련 결정: D-112(관리자 세션·고위험 작업은 실제 Google 재인증). 코드: `worker/src/oidc.ts`(`beginLogin`·`requireFreshAuth`), `worker/src/accounts-api.ts`(재인증 콜백), `worker/src/admin/api.ts`(관리자 세션).

## 1. 현재 구현

- 관리자 재인증(`purpose=admin`)은 Google 인가 요청에 `prompt=login`, `max_age=0`을 붙인다. 일반 로그인은 `prompt=select_account`다.
- 콜백은 ID 토큰의 서명·발급자·대상·만료·nonce를 검증한다. 그다음 **`auth_time`이 있어야 하고, 이번 재인증 시작 시각(허용 오차 60초) 이후여야** 한다(`requireFreshAuth`). 없거나 오래되면 거절한다.
- 통과하면 2분짜리 1회용 티켓을 만든다(검증 시간 기준: 재인증 유효 10분 `freshMs`, `auth_time` 허용 오차 60초 `REAUTH_SKEW_MS`, 관리자 세션 30분 유휴·4시간 절대). 이 티켓은 계정·탭에 묶여 있고, 회원 세션과 함께 제출해야 관리자 세션(30분 유휴·4시간 절대 만료)이 발급된다.

## 2. 로컬 시험과 실제 Google의 차이

로컬 시험(`tests/helpers/fake-idp.ts`, `tests/admin-*.test.ts`)은 가짜 IdP를 쓴다. 가짜 IdP는 요청 파라미터를 기록하고, `auth_time`을 원하는 값으로 서명해 준다. 그래서 **우리 코드의 검증 논리는 확인되지만, Google이 실제로 어떻게 응답하는지는 확인되지 않는다.**

| 항목 | 로컬 가짜 IdP | 실제 Google에서 확인할 것 |
|---|---|---|
| `prompt=login` | 그대로 받아들이고 기록 | Google이 이 값을 지원하는지. Google 문서에 명시된 값은 `none`·`consent`·`select_account`다. 지원하지 않으면 오류(`invalid_request`)가 나거나 무시되어, 재인증 없이 기존 세션으로 통과할 수 있다 |
| `max_age=0` | 항상 새 `auth_time` | Google이 실제로 비밀번호(또는 2단계 인증) 재입력을 요구하는지, 이미 로그인된 브라우저에서는 어떻게 되는지 |
| `auth_time` 클레임 | 항상 포함 | `max_age`를 보냈을 때 ID 토큰에 포함되는지. 빠지면 현재 코드는 **거절**한다(fail closed: 관리자가 로그인하지 못할 뿐 우회는 아님) |
| `auth_time` 값 | 요청 시각 | 기존 Google 세션을 재사용하면 과거 시각이 온다 → 현재 코드는 거절한다. 실제 재입력 뒤에는 새 시각이 오는지 |
| 계정 선택 | 단일 계정 | 브라우저에 Google 계정이 여러 개 있을 때 다른 계정으로 재인증하면 `sub`가 달라짐 → 티켓이 회원 세션과 맞지 않아 거절되는지 |
| 2단계 인증 | 없음 | 운영자 계정의 2단계 인증이 재인증에 포함되는지(감사 C1) |
| 시계 차이 | 같은 프로세스 | Worker 시각과 Google `auth_time`의 차이가 60초 허용 오차 안인지 |
| 리디렉션 URI·동의 화면 | 루프백 전용 | OAuth 클라이언트의 승인된 리디렉션 URI, 동의 화면 게시 상태(테스트 사용자 제한) |

## 3. 안전한 검증 절차 (사용자 참여 필요)

운영 Worker·운영 OAuth 클라이언트·운영 데이터는 건드리지 않는다. 결과는 공개 저장소에 요약만 남기고, 토큰과 클레임 원문은 남기지 않는다.

1. **사용자:** Google Cloud 콘솔에서 **검증 전용 OAuth 클라이언트**를 만든다(무료, 운영 클라이언트와 분리). 승인된 리디렉션 URI는 `http://127.0.0.1:8787/auth/google/callback`이다. 동의 화면은 "테스트" 상태로 두고 테스트 사용자에 본인 계정만 넣는다.
2. **사용자:** 클라이언트 ID와 비밀값을 이 대화에 붙여 넣지 않는다. 대신 사용자 컴퓨터의 `worker/.dev.vars`(Git 제외)에 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`·`AUTH_SECRET`·`APP_URL=http://127.0.0.1:5173/YachtLab/`로 저장한다. `ADMIN_ACCOUNTS`에는 **로컬 전용**으로 본인 회원 ID를 넣는다. `ADMIN_WRITES`는 넣지 않는다(읽기만).
3. **사용자 컴퓨터에서:** `npx wrangler dev --local --config worker/wrangler.toml --port 8787`과 `npm run dev`를 실행한다. 로컬 저장소만 쓰고 Cloudflare 계정은 쓰지 않는다.
4. 시나리오(각각 결과와 화면 기록을 남긴다):
   - S1 이미 Google에 로그인된 브라우저에서 관리자 재인증 → Google이 재입력을 요구하는지, 콜백이 성공하는지(`auth_time` 새 값)
   - S2 `prompt=login`의 Google 응답 확인(오류면 §4의 대안 적용 필요)
   - S3 다른 Google 계정으로 재인증 → 거절(`admin-reauth-error`)
   - S4 재인증 뒤 10분(`freshMs` = 600,000 ms)이 **지나기 전** 고위험 작업 → 허용, 10분이 **지난 뒤** → `REAUTH_REQUIRED`로 다시 인증 요구. 경계 확인은 9분·11분 두 시점에서 한다
   - S4b 재인증 시작 뒤 Google 화면에서 1분 넘게 머문 뒤 완료 → `auth_time`이 시작 시각 이후라 통과(허용 오차 60초는 시작 시각보다 **이전**인 경우에만 적용)
   - S4c 재인증 완료 뒤 2분(티켓 유효 시간) 넘게 지나 관리자 세션 요청 → 티켓 만료로 거절
   - S5 티켓을 다른 탭·다른 회원 세션으로 사용 → 거절
   - S6 2단계 인증이 켜진 계정에서 재입력에 2단계가 포함되는지
5. **에이전트:** 사용자가 공유한 결과(성공·실패와 오류 코드만, 토큰 없음)로 구현을 조정하고 결과를 기록한다. 필요하면 사용자 컴퓨터 연결(Remote Control) 승인을 받아 같은 절차를 함께 실행할 수 있다.

## 4. Google이 `prompt=login`을 지원하지 않을 때의 대안 (검증 뒤 선택)

| 대안 | 내용 | 비고 |
|---|---|---|
| `max_age=0`만 사용 | `prompt` 없이 `max_age`로 재인증 요구, `auth_time` 검사는 그대로 | Google 동작 확인 필요 |
| `prompt=consent` + `max_age=0` | 동의 화면을 매번 띄움 | 비밀번호 재입력 보장은 아님 |
| 2단계 확인 추가 | Google 재인증과 별도로 관리자 전용 TOTP(시크릿은 Worker 시크릿) | 구현·운영 부담 큼, 정책 승인 필요 |

어느 경우든 `auth_time` 검사(fail closed)는 유지한다. 실제 검증 전에는 `ADMIN_ACCOUNTS` 운영 등록과 `ADMIN_WRITES` 활성화를 하지 않는다.
