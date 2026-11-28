import type { CoachStep } from "./Coach";

/**
 * Short step-by-step guides for 인벤토리·강화, 퀘스트, 업적 (A4). They explain and point at the real UI;
 * they never buy, upgrade, equip or move currency, give no reward for finishing, and can be skipped
 * (건너뛰기 / Esc) and replayed from the page's 사용법 button. The shop and draw guides already cover
 * buying, preview, odds and duplicates, so nothing about those is repeated here.
 * First visit is remembered per guide id on this device (Coach: `yachtlab.coach.v1`).
 */
export const INVENTORY_STEPS: CoachStep[] = [
  { target: ".loadout-preview", title: "지금 장착한 모습", body: "고른 주사위·보드판·닉네임이 실제 모습 그대로 보여요. 바꾸고 나면 아래 ‘장착 저장’을 눌러야 적용돼요." },
  { target: '.item-tabs[aria-label="상품군"]', title: "상품군별로 고르기", body: "상품군 탭마다 내가 가진 상품만 모여 있어요. 상품을 누르면 장착하거나 단계별 모습을 미리 볼 수 있어요." },
  { target: '.item-tabs[aria-label="상품군"]', title: "강화는 상세 화면에서", body: "강화할 수 있는 상품은 상세 화면에서 코인으로 한 단계씩 올려요. 비용은 미리 보여 주고, 확인을 한 번 더 눌러야 진행돼요. 이미 가진 단계는 그대로예요." },
  { target: ".loadout-save", title: "장착 저장", body: "저장하지 않은 변경이 있으면 여기에 알려 줘요. 이모티콘·채팅은 개수와 순서도 저장돼요." },
];
export const QUEST_STEPS: CoachStep[] = [
  { target: '.item-tabs[aria-label="퀘스트 종류"]', title: "일일·주간·업적", body: "일일은 매일, 주간은 매주 새로 바뀌어요. 업적 탭에서는 오래 걸리는 목표를 볼 수 있어요." },
  { target: ".quest-list", title: "진행도와 보상", body: "퀘스트마다 진행도와 코인·보석 보상이 보여요. 빠른 대전·친구 대전·서버 AI 대전을 끝까지 마친 경기만 진행돼요." },
  { target: ".quest-list", title: "마음에 안 드는 퀘스트", body: "일일 퀘스트는 하루 한 번 무료로 교체할 수 있어요. 완료한 퀘스트는 바꿀 수 없어요." },
];
export const ACHIEVEMENT_STEPS: CoachStep[] = [
  { target: '[role="tabpanel"][aria-label="업적"]', title: "업적 목록", body: "누적·실력·행운·수집으로 나뉘어 있고 진행도가 보여요. 숨김 도전은 달성하면 이름이 공개돼요." },
  { target: '[role="tabpanel"][aria-label="업적"] .ach-list', title: "보상", body: "달성하면 코인이나 보석을 받고, 일부는 전용 칭호도 받아요. 안내를 끝까지 본다고 보상이 따로 생기지는 않아요." },
  { target: '[role="tabpanel"][aria-label="업적"] .ach-list', title: "대표 업적", body: "프로필 화면의 ‘업적’에서 대표로 보일 업적을 3개까지 고를 수 있어요(지금은 이 기기에서만 보여요)." },
];
