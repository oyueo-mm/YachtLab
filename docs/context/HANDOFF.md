# 새 채팅을 위한 YachtLab 인수인계

이 문서는 대화가 바뀌어도 프로젝트를 정확하게 이어가기 위한 **공용 핸드오프 지침**이다.

## 새로운 ChatGPT/에이전트가 해야 할 일

> **공개 검색·연구 콘텐츠**는 [검색 의도 조사](./SEARCH-INTENT-2026-11-26.md), [SEO 자동화](./SEO-AUTOMATION.md), `scripts/seo/research-content.mjs`에서 시작한다. 공개 한국어·영어 보고서는 동일한 실험 표와 출처를 사용한다.

> **게임 리뷰**는 [제품 복기의 수치 기준과 데이터 경계](./AI-REVIEW.md)에서 시작한다. 브라우저 Web Worker에서 DP Expert와 작은 v5 종반 범위를 사용한다.

> **경제 v2 연구(C1, 2026-11-27, 초안·운영 미반영)** → [ECONOMY-V2-RESEARCH](../economy/ECONOMY-V2-RESEARCH.md)와 Codex 인수인계 [HANDOFF-C1-ECONOMY-V2](../economy/v2/HANDOFF-C1-ECONOMY-V2.md). 시뮬레이터 `src/economy/v2/`, 실행 `scripts/economy/v2/`. 정책은 미승인.
>
> **1인 플레이·프로필·컬렉션·시너지·한정판·상점 안내·오디오 믹스(2026-11-27)** → [COLLECTIONS-2026-11-27](./COLLECTIONS-2026-11-27.md), [STREAK-REVIEW-2026-11-27](./STREAK-REVIEW-2026-11-27.md), [오디오 믹스](../audio/MIX.md), D-074~D-078. 코드: 1인 플레이 `src/play/SoloGame.tsx`·`src/solo/`(기록·동기화), 오프라인 장착 `src/play/own-look.ts`, 프로필 `src/shell/ProfileSections.tsx`, 컬렉션 `src/economy/live/collections.ts`, 시너지 `src/play/board-synergy.ts`, 2.5D 효과 `src/dice3d/Dice25Fx.tsx`·`src/play/tray-attach.ts`, 안내 `src/ui/Coach.tsx`, 믹스 `src/sound.ts`(버스·`volumeCurve`)·`src/audio/bgm-render.ts`(`normalize`). **워커 배포 전**에는 1인 기록 계정 보관과 신규 11종 판매가 꺼져 있다(의도된 안전 동작).
>
> **꾸미기 연출·설정·BGM·단축키·규칙/FAQ 페이지 작업이면** [POLISH-2026-11-26](./POLISH-2026-11-26.md)과 D-068~D-073부터: 효과 데이터 `src/dice3d/dice-fx.ts`·`src/board-fx.ts`·`src/emote-fx.ts`(단계 설명은 `src/fx-texts.ts`와 테스트로 동기화), 렌더러 `src/dice3d/fx-canvas.ts`, 이벤트 `src/fx-bus.ts`, 설정 `src/settings.ts`, 공통 UI `src/ui/kit.tsx`, 단축키 `src/ui/shortcuts.tsx`, BGM `src/audio/`. 음원 라이선스는 [audio/LICENSES](../audio/LICENSES.md).
>
> **재화·퀘스트·업적·상점 작업이면 먼저 [실서비스 경제](../economy/LIVE-ECONOMY.md)** — 실제 구현(M3i-W30, 설정 `src/economy/live/config.ts`, 상품 `catalog.ts`, 규칙 `rewards.ts`, 원장 `worker/src/economy.ts`, D-040~D-042). 연구 배경은 [경제 연구](../economy/ECONOMY-RESEARCH.md). 온라인 매칭·관전방·서버 AI는 [MATCHMAKING](../online/MATCHMAKING.md)·[SERVER-AI-MATCH](../online/SERVER-AI-MATCH.md)(D-038·D-039).
>
> **2026-11-25 완성도·콘텐츠·친구 작업 이후라면** [제품 개발 현황](./PRODUCT-2026-11-24.md)의 "2026-11-25" 절, [친구 시스템](../online/FRIENDS.md), [아이템 콘텐츠](../economy/ITEM-CONTENT.md)와 D-045~D-052를 먼저 본다: 빠른 대전 공개 필수·프로필 닉네임(D-045), 방 생명주기·`left` 기권(D-046), 채팅 미전송 근본 원인(D-047), PC 게임 화면(D-048), 라지 스트레이트·결과 소리(D-049), 상점·인벤토리·아이템 200종·미리보기(D-050), 친구·초대(D-051), 착지 뒤 특수 효과음과 Pages 회귀 검증(D-052).
>
> **신규 사용자·모바일 릴리스**는 [제품 개발 현황의 운영 반영 기록](./PRODUCT-2026-11-24.md#2026-11-25-신규-사용자모바일-운영-반영)과 D-052~D-055에서 시작한다. 계정 소유자가 Workers Free와 유료 결제 수단 미등록을 확인했다. 기존 Worker를 배포하고 이전 공개 클라이언트에서 연결을 확인한 뒤 #71을 `main`에 병합했다. 공개 브라우저 검증 기록은 통합 PR에서 확인한다. [통합 PR](https://github.com/oyueo-mm/YachtLab/pull/71)
>
> **게임·온라인·계정(제품) 작업이면 먼저 [제품 개발 현황](./PRODUCT-2026-11-24.md)** — 제품 Phase 번호, 완료/미검증/외부 설정 필요 구분, 배포 기록, 백로그. 설계는 [소셜·계정](../online/SOCIAL-AND-ACCOUNTS.md), 모바일·성능은 [PR A 문서](../ui/PHASE-A-2026-11.md).

> **AI 승률 연구를 이어간다면** [Win DP v5 연구](./V5-APEX-RESEARCH.md)부터: 전 상태 정확 DP Expert PMF 은행(`src/research-v5/`), 정확 2인 종반 솔버, v5-R 확증 결과, 실패한 시도(depth-2·Bayesian), 결정 D-V5-1. 새 후보는 시드 family 9001~(개발)/9501~(확증) 규칙을 따른다.
> **v6 이후:** [V6-APEX-RESEARCH](./V6-APEX-RESEARCH.md) — v6-P(지수효용 정책군 롤아웃)가 확증 9511·재현 9512에서 v5-R과의 직접 대결 50.131%/50.209%로 작지만 유의하게 이겼다. 공통 상대 v2에 대한 이득은 미확정이다. 더 깊은 BR과 잔차·Bayesian 변형은 이득이 없었고, 원인으로 상대 반응을 무시한 낙관 편향(§3.2)이 측정되었다. 다음 연구의 핵심은 **상대 반응 모델**이다. 실행 최적화 산출물(WASM/Rust 생성기, 단일 복사 로더, Float32/INT16)은 바로 재사용 가능. 시드: 개발 9011~9049, 확증 9511/9512는 사용 완료 → 다음 확증은 9521~.
> **AI 연구 상태(2026-11-26): 잠정 종료(D-V7-6).** 매우 어려움은 v4-D 유지, v5-R·I2RO1 교체 보류. 최종 결과와 재개 지점은 [V7-APEX-RESEARCH §9–11](./V7-APEX-RESEARCH.md)와 [V7-PRODUCT-HANDOFF](./V7-PRODUCT-HANDOFF.md)(보류 상태로 보존).
> **v7 이후:** [V7-APEX-RESEARCH](./V7-APEX-RESEARCH.md) — 상대 1턴 반응을 정지가치에 넣은 v7-I1RO(판단 2 ms)가 v6-P와의 직접 대결에서 9531 50.091%(Holm 보정 후 α=0.01 미달), 독립 재현 9541 50.136%(유의). 정확 결정 손실(regret) 벤치마크로 후보를 고른다. 시드: 개발 9101~9108, 확증 9531/9541 사용 완료, 추가 확증 9551~9553 실행 중(사전 등록 §7) → 다음 확증은 9561~(9521~9530은 Codex용). v7.1 진행: I2 계열(두 수 반응)이 정확 regret을 크게 줄임, 학습 잔차는 외삽 실패, 서버 측정은 §8.6.
> **제품 통합(Codex):** [V6-INTEGRATION-HANDOFF](./V6-INTEGRATION-HANDOFF.md) — v5-R(제품용 경량 후보) 호출법, WASM 은행 생성기(`buildBankWasm`·`bankFromWasm`), Float32/INT16 `YPB1` 은행 형식(`bank-codec.ts`), 분석 API v6 사용법과 표시 규칙, 통합 전 점검 목록. 기본 AI·난이도는 바꾸지 않는다.

1. 우선 [맥락 허브](./README.md), [자동 생성 현재 상태](./_generated/CURRENT_STATE.md), [검증 결과](./RESULTS.md), [연구 로드맵](./ROADMAP.md), [전체 기법 도감](./TECHNIQUES.md)을 읽는다.
2. 작업이 특정 AI와 관계된다면 **현재 GitHub main의 실제 코드**(src/ai.ts, src/engine.ts, src/dp.ts, src/win-dp.ts, src/competitive-v2.ts)를 확인한다. 문서만 보고 현재 구현을 추측하지 않는다.
3. 이전 대화에서 유래한 정보는 최신 GitHub 상태와 충돌할 수 있다. 충돌 시 **현재 코드 및 실험 아티팩트**가 우선하며, 불일치를 기록한다.
4. 요청이 개발·배포를 포함할 경우 보존할 모델·원본 테이블을 먼저 확인한다. 별도 브랜치/PR→테스트→배포로 진행하고 실패하면 main을 바꾸지 않는다.
5. 새 알고리즘은 처음부터 **가설/구현/학습/평가/확증/배포** 상태를 구분한다.
6. 성능 보고에서 승리 점수율(무승부 0.5), 평균 총점, 상대 AI, 게임 수, 시드 묶음, 95% CI, 추론 시간을 구분한다.
7. 사용자는 연구 후보 여러 개를 **가능하면 한 번에 구현·실험·검증**하는 진행 방식을 선호한다. 불필요하게 여러 번의 지시를 요구하지 않는다. 다만 실제 한계나 성능 미확인 상태는 솔직하게 표기한다.
8. 작업이 끝나면 변경된 구현·검증·실험·실패·다음 작업을 각각 문서에 남긴다. 다음 대화에서 같은 질문을 반복하지 않도록 해 주는 것이 이 허브의 목적이다.

## 복사 가능한 짧은 시작 요청

> GitHub oyueo-mm/YachtLab의 CONTEXT.md와 docs/context/README.md, _generated/CURRENT_STATE.md, RESULTS.md, ROADMAP.md, TECHNIQUES.md를 읽고 **실제 현재 코드와 대조**해 맥락을 파악해 줘. 이전의 미완료 연구와 실험·근거·배포 상태를 구분하고, 이번 요청을 한 번의 작업으로 처리해 줘. 결과는 GitHub에 문서화해 줘.

## 주의

- 이 맥락 허브는 대화의 모든 원문을 자동 수집하지 않는다. GitHub에 없는 대화만의 새로운 결정을 다음 채팅으로 전달하려면, 해당 작업 중 이 문서를 갱신하도록 명시하거나 ChatGPT의 GitHub 연결로 수정해야 한다.
- 아직 테스트되지 않은 모델을 기존 Win DP v2 또는 DP Expert보다 강하다고 소개하지 않는다.
- 모델의 계산 속도/예산과 확률적 시드 접근 공정성을 모든 비교에서 점검한다.

## 게임 리뷰 제품 화면

사용자에게 표시되는 명칭은 게임 리뷰다. 과거 기보 · 캐시 · 회원 리뷰 API는 호환된다. [게임 리뷰](./AI-REVIEW.md)의 정확도 공식과 분석 범위를 확인한다.

## 제품 업데이트 인수인계

게임 리뷰, 경기 종료 결과, 보드 표면, 소재음, v5-R 시험판, 확장 분석의 코드·검증은 [제품 개발 현황](./PRODUCT-2026-11-24.md#게임-리뷰경기-결과보드사운드-제품-업데이트)과 [v5-R 제품 검증](./V5-R-PRODUCT.md)을 참고한다. 매우 어려움의 기본 v4-D와 다섯 난이도를 유지하고, 신청한 탭에서만 v5-R 단일 WASM 은행을 실행한다. 제품 실기기 검증과 Claude의 v7 이후 연구는 독립적으로 진행한다.

공개 배포 상태와 테스트 집계는 [2026-11-25 운영 검증](./PRODUCT-2026-11-24.md#2026-11-25-운영-검증)을 본다.

## 최초 방문과 메뉴 인수인계

[2026-11-26 최초 방문과 내비게이션](./PRODUCT-2026-11-24.md#2026-11-26-최초-방문과-내비게이션)과 D-059를 참고한다. `src/play/Tutorial.tsx`는 대전용 렌더러에 정해진 결과를 전달한다. 일반 메뉴에서는 첫 방문 튜토리얼을 다시 실행할 수 없고 `#practice`에서 별도 연습 차례를 시작할 수 있다(2026-11-27부터 오프라인 메뉴 버튼 대신 규칙 페이지·FAQ의 "튜토리얼 다시 하기"가 연결). 셸 메뉴와 계정 접근은 `src/shell/Chrome.tsx`에 있다.


## 온라인 요트다이스 브랜드·경제 출시

[제품 업데이트](./ONLINE-YACHT-PRODUCT.md)에서 릴리스 순서, 검증 현황, SEO 등록 절차를 확인한다. [뽑기 경제](../economy/ONLINE-YACHT-DRAW.md)에서 7,776개 전수 확률, 서버 계정 원장, 시즌 기간, 시뮬레이션과 롤백을 확인한다. 매우 어려움 기본은 v4-D, 시험 경로는 v5-R이다.
