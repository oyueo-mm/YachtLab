import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURE_CHATS, FIXTURE_FREE, FIXTURE_PAID } from "../src/chat/a2-fixture";
import { CHAT_AMP, chatMoodOf } from "../src/chat/chat-mood";
import { SOCIAL_ITEMS } from "../src/social/catalog";
import { ITEMS } from "../src/economy/live/catalog";
import { groupByTier } from "../src/play/SocialDock";

const css = readFileSync(new URL("../src/cosmetics-a2.css", import.meta.url), "utf8");
const allCss = ["items.css", "items-content.css", "cosmetics-a2.css"].map((f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8")).join("\n");

const CONFIRMED = {
  common: ["수고했어요!", "잠시만요", "축하해요!", "재밌네요!", "그러네요", "그렇군요", "아깝네요", "아쉽네요", "좋은 선택이에요!"],
  rare: ["와!", "대단해요!", "아...", "어렵네요", "멋지네요!", "잘하시네요!", "나이스!", "고민되네요."],
  epic: ["?", "!", "어라?", "정말요?", "설마요?", "훌륭해요!", "안타깝네요.", "저런…", "이런…"],
  legendary: ["놀랍네요!", "대박!", "안 돼요!", "한 번만!", "아니…", "쉽지 않죠?", "고민 중…"],
  mythic: ["이럴 수가!", "말도 안 돼요!", "이게 무슨…", "요트!", "요트 한 번만!"],
} as const;

describe("A2 chat fixture (test data, not the live catalog)", () => {
  it("has the 38 confirmed lines with the proposed 9/8/9/7/5 split, in the confirmed order", () => {
    expect(FIXTURE_PAID).toHaveLength(38);
    for (const [tier, lines] of Object.entries(CONFIRMED)) expect(FIXTURE_PAID.filter((l) => l.proposedTier === tier).map((l) => l.text)).toEqual(lines);
  });
  it("proposes 6 free lines and does not repeat any paid line", () => {
    expect(FIXTURE_CHATS.filter((l) => l.acquisition === "default").map((l) => l.text)).toEqual([...FIXTURE_FREE]);
    expect(FIXTURE_FREE).toHaveLength(6);
    const texts = FIXTURE_CHATS.map((l) => l.text);
    expect(new Set(texts).size).toBe(texts.length);
  });
  it("never collides with a permanent id and is not part of the live catalog", () => {
    const live = new Set(SOCIAL_ITEMS.map((i) => i.id));
    for (const l of FIXTURE_CHATS) {
      expect(l.id.startsWith("fixture.chat.")).toBe(true);
      expect(live.has(l.id)).toBe(false);
    }
    expect(new Set(FIXTURE_CHATS.map((l) => l.id)).size).toBe(FIXTURE_CHATS.length);
  });
  it("the sheet groups by tier in a fixed order, free lines first", () => {
    const groups = groupByTier(FIXTURE_CHATS).map(([t, g]) => [t, g.length]);
    expect(groups).toEqual([["basic", 6], ["common", 9], ["rare", 8], ["epic", 9], ["legendary", 7], ["mythic", 5]]);
  });
});

describe("A2 chat motion follows meaning, not just tier", () => {
  it("maps the confirmed lines to distinct moods", () => {
    const m = (t: string) => chatMoodOf(t);
    expect(m("정말요?")).toBe("ask");
    expect(m("?")).toBe("ask");
    expect(m("저런…")).toBe("sigh");
    expect(m("아...")).toBe("sigh");
    expect(m("안타깝네요.")).toBe("sigh");
    expect(m("한 번만!")).toBe("plead");
    expect(m("요트 한 번만!")).toBe("plead");
    expect(m("요트!")).toBe("shout");
    expect(m("대박!")).toBe("shout");
    expect(m("멋지네요!")).toBe("cheer");
    expect(m("그렇군요")).toBe("calm");
    expect(m("아쉽네요")).toBe("sigh");
  });
  it("covers every live catalog line and fixture line with a mood and a tier strength", () => {
    for (const t of [...SOCIAL_ITEMS.filter((i) => i.kind === "chat").map((i) => i.text), ...FIXTURE_CHATS.map((l) => l.text)]) expect(chatMoodOf(t)).toBeTruthy();
    for (const tier of ["basic", "common", "rare", "epic", "legendary", "mythic"]) expect(CHAT_AMP[tier]).toBeGreaterThan(0);
    expect(CHAT_AMP.mythic).toBeGreaterThan(CHAT_AMP.common);
  });
  it("every mood has its own keyframes", () => {
    for (const mood of ["cheer", "ask", "sigh", "plead", "shout", "calm"]) expect(css).toContain(`.chat-m-${mood} .feed-text { animation-name: chat-${mood}`);
  });
});

describe("A2 every sold cosmetic has its own presentation rule", () => {
  const cls = (cat: string) => [...new Set(ITEMS.filter((i) => i.category === cat).map((i) => i.look.css ?? "").flatMap((c) => c.split(/\s+/)).filter(Boolean))];
  it("bubbles: every bubble-* class has a dedicated surface/decoration rule", () => {
    for (const c of cls("bubble").filter((c) => /^bubble-[a-z]+$/.test(c))) expect(allCss, c).toContain(`.feed-msg.${c}`);
    for (const c of ["mint", "sky", "lemon", "lavender", "peach", "cloud", "check", "dots", "frost", "neon", "sunset", "aurora", "holo", "gold", "christmas"]) expect(css, c).toContain(`.feed-msg.bubble-${c}`);
  });
  it("name effects: every namefx-* class has a distinct decoration or motion in this pass", () => {
    for (const c of cls("nameFx").filter((c) => /^namefx-/.test(c) && !/glow|rainbow/.test(c))) expect(css, c).toContain(`.${c}`);
  });
  it("frames: every pf-ring-* class has its own frame drawing", () => {
    for (const c of cls("profile").filter((c) => /^pf-ring-/.test(c))) expect(css, c).toContain(`.${c}::before`);
  });
  it("titles: every shop and achievement title (except none) has its own mark", () => {
    for (const t of ITEMS.filter((i) => i.category === "title" && i.id !== "title.none")) expect(css, t.id).toContain(`data-title="${t.id}"`);
  });
  it("special effects: every shape except plain confetti (falls) and bubble (rises) has a win staging; yacht and large straight have their own", () => {
    const shapes = new Set(ITEMS.filter((i) => i.category === "fx").map((i) => i.look.fx?.shape));
    for (const s of shapes) if (s && !["bubble", "confetti"].includes(s)) expect(css, String(s)).toMatch(new RegExp(`fx-kind-win[^{]*fx-shape-${s}|fx-kind-win:is\\([^)]*fx-shape-${s}`));
    expect(css).toContain(".fx-burst.fx-kind-yacht i");
    expect(css).toContain(".fx-burst.fx-kind-large i");
  });
  it("every animation is switched off for reduced effects", () => {
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain(':root[data-fx-reduced] .player-icon[class*="pf-ring-"]::before');
    expect(css).toContain(':root[data-fx-tier="2"] .player-icon[class*="pf-ring-"]::before');
  });
});

import { canSend, socialItem } from "../src/social/catalog";
import { CHAT_SOUND_TIERS, CHAT_VOICES } from "../src/sound";
import { emoteFx } from "../src/emote-fx";

describe("A2 chat sound is sparse and mood-based", () => {
  it("every mood except calm has a voice; basic/common/rare and calm lines are silent", () => {
    for (const mood of ["cheer", "ask", "sigh", "plead", "shout"]) expect(CHAT_VOICES[mood]).toBeTypeOf("function");
    expect(CHAT_VOICES.calm).toBeUndefined();
    expect([...CHAT_SOUND_TIERS].sort()).toEqual(["epic", "legendary", "mythic"]);
  });
});

describe("A2 fixture lines never reach the live service", () => {
  it("fixture ids are unknown to the catalog, cannot be sent, and are not shop items", () => {
    const all = new Set(FIXTURE_CHATS.map((l) => l.id));
    for (const id of all) {
      expect(socialItem(id)).toBeNull();
      expect(canSend(id, all)).toBe(false);
    }
    expect(ITEMS.some((i) => all.has(i.id))).toBe(false);
  });
  it("the preview resolver is opt-in: the game's default resolver is the live catalog", () => {
    const src = readFileSync(new URL("../src/play/SocialDock.tsx", import.meta.url), "utf8");
    expect(src).toContain("resolve: ResolveItem = socialItem");
    expect(src).toContain("resolve = socialItem");
    const online = readFileSync(new URL("../src/play/OnlineGame.tsx", import.meta.url), "utf8");
    expect(online).not.toContain("a2-fixture");
  });
});

describe("A2 emote touch-ups", () => {
  it("question / exclaim / cool now have their own bursts", () => {
    for (const id of ["emote.question", "emote.exclaim", "emote.cool"]) expect(emoteFx(id)?.burst?.length).toBeGreaterThan(0);
  });
});
