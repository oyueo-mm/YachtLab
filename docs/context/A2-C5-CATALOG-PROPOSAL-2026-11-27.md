# A2 → C5 카탈로그·데이터 계약 제안 (2026-11-27)

> A2(꾸미기·채팅 연출)가 C5(Codex)에게 **요청만** 하는 문서다. A2 브랜치는 아래 파일을 **변경하지 않았다**:
> `src/economy/live/{catalog,content-items,config,draw}.ts`, `src/social/catalog.ts`.
> 가격·강화비·뽑기 확률·C1-PRICE(미승인)·기존 소유권/강화/장착/무료 권한·영구 ID 의미는 그대로다.
> A2 코드는 현재 카탈로그만 읽고, 신규 문구·등급은 `src/chat/a2-fixture.ts`(테스트 fixture, `fixture.chat.*` ID)로만 검증한다.

## 1. 채팅 38종 (문구 확정, 등급은 제안) — 실제 카탈로그 반영 시 필요한 것

fixture 기준 제안 배분(일반 9 · 고급 8 · 영웅 9 · 전설 7 · 신화 5)과 무료 6종은 `src/chat/a2-fixture.ts`·`tests/a2-cosmetics.test.ts`가 고정한다. 현재 카탈로그와의 관계:

| 항목 | 현재 `social/catalog.ts` | 제안 |
|---|---|---|
| 무료 6 | 안녕하세요!·화이팅!·**대단해요!**·감사합니다!·좋은 경기였어요!·잘 부탁해요! (`chat.great`) | 무료 6종 제안은 `대단해요!` 대신 `좋아요!`. **`chat.great`는 현재 무료 보유자가 있으므로 ID·문구·무료 권한을 유지**하고, `좋아요!`는 새 ID(예 `chat.good`)로 추가하는 방식 필요. `대단해요!`(고급 후보) 중복 해결 방법은 C5 결정 |
| 문구 중복 | `아쉽네요!`(느낌표 있음), `축하해요!`, `잠시만요!`, `좋은 선택이에요!` 등 | 확정 문구는 느낌표가 다르다(`아쉽네요`, `잠시만요`). 기존 ID 문구를 **바꾸지 말고**(소유자 표시 문구가 바뀜) 새 ID 추가 또는 승인된 이전 필요 |
| 신규 ID | — | 기존 영구 ID와 다른 새 ID 규칙(예 `chat.v2.*`)을 C5가 정할 것. A2는 fixture ID를 운영에 쓰지 않는다 |

요청: ① 38종의 영구 ID와 등급 확정, ② 기존 ~50종 채팅(`chat.nice`, `chat.lucky` 등)의 처리(유지/퇴역 `retired`/보상) 결정, ③ 소급 청구 없음 원칙 확인.

## 2. A2가 읽는 새 속성(선택) — 있으면 더 정확, 없어도 동작

현재 A2는 문구에서 움직임(mood)을 **추정**한다(`src/chat/chat-mood.ts`: `…`/`...`/`.` 끝=sigh, `?`=ask, `!`=cheer, "한 번만"=plead, 감탄 단문=shout, 나머지 calm). 추정이 틀리는 경우를 막으려면 SocialItem에 선택 필드를 둘 수 있다:

```ts
type SocialItem = {
  // ... 기존
  /** 채팅 자체의 움직임. 없으면 문구에서 추정(chat-mood.ts). */
  mood?: "calm" | "cheer" | "ask" | "sigh" | "plead" | "shout";
};
```

등급(`tier`)은 이미 있어 움직임 **세기**(`CHAT_AMP`: basic 0.5 … mythic 1.5)로 쓴다. 말풍선(`bubble.*`)과 채팅 움직임은 분리돼 있어 말풍선 쪽 속성은 필요 없다.

## 3. 칭호 전용 표식 (선택)

칭호 CSS 클래스는 `title-{tier}` 하나뿐이라 A2는 `data-title="title.<id>"` 속성과 CSS(`cosmetics-a2.css`)로 칭호마다 표식(◆ ★ ↻ …)을 붙였다. **새 칭호를 추가하면 CSS에 표식 한 줄이 필요**하다(`tests/a2-cosmetics.test.ts`가 누락을 잡는다). 대안: `ItemDef.look`에 `glyph?: string`을 두고 A2가 읽도록 하면 CSS 수정이 필요 없다.
- 기존 모든 칭호에 표식이 있다(A2.1에서 새내기 ☆·주사위 장인 ▣·300클럽 ◉·310클럽 ✪ 추가).

## 3-1. 채팅 효과음 (A2.1)

`src/sound.ts`의 `CHAT_VOICES`/`CHAT_SOUND_TIERS`(영웅 이상·calm 제외)가 문구 mood와 `SocialItem.tier`만 읽는다. 등급이 재분류되면 소리 대상도 따라 바뀐다(별도 필드 불필요). 소리를 끄고 싶은 문구가 있으면 `mood: "calm"`을 주면 된다.

## 4. 특수 효과(`fx.*`) 레벨 설명 문구

A2에서 **라지 스트레이트**에도 `fx` 아이템 Lv.2 이상이 연출되도록 표현을 추가했다(온라인 대전, 점수 기록 시). 상품의 단계 설명 문구(`levels: ["승리 연출", "요트 연출 추가", "전용 효과음"]`, `content-items.ts`)는 C5 영역이라 **그대로**다. 필요하면 `"요트·라지 스트레이트 연출 추가"`로 바꾸는 문구 수정을 요청한다(가격/소유권 영향 없음, 문구만).

## 5. 새 상품 분류가 필요한 영역 (A2는 하지 않음)

- 주사위·보드판·이모티콘 등급 변경(확정 사항: 황금/로열/홀로그램 신화→전설 등)은 이번 A2 범위가 아니며 C5가 처리한다. 등급이 바뀌면 `tierLabel`·가격·강화비가 자동으로 영향받으므로 승인 필요.
- 이모티콘 등급 재분류 후 `EMOTE_FX`/`EMOTE_LEVEL_TEXT`(`src/emote-fx.ts`)는 ID 기반이라 수정 불필요.
- 신규 상품 ID를 만들 때 `rev: 2`·`drawExcluded`(워커 미배포 시 "판매 준비 중" 표시)를 따른다(COLLECTIONS-2026-11-27 §1).

## 6. 이번 PR이 바꾸는 계약(참고)

- 새 파일: `src/chat/{a2-fixture,chat-mood}.ts`, `src/play/ChatMessage.tsx`, `src/lab/CosmeticsLab.tsx`, `src/cosmetics-a2.css`.
- `PublicLook`·워커 프로토콜·소유권/장착 스키마 **변경 없음**. `FxBurst`는 선택 prop `kind`만 추가(기본 `win`).
- 설정 `reducedEffects`를 `<html data-fx-reduced>`로 미러링(표현 전용).
