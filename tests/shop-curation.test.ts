import { describe, expect, it } from "vitest";
import { CATEGORIES, DEFAULT_LOADOUT, ITEMS, itemById, priceOf } from "../src/economy/live/catalog";
import { COLLECTIONS } from "../src/economy/live/collections";
import { EDITOR_PICKS, EMPTY_QUERY, PRICE_BANDS, SORTS, filterItems, purchasable, isFiltered, matchesText, newItems, promoSlides, sortItems, sortPrice, themeProgress } from "../src/shell/shop/curation";
import { accountOf, applyPreset, loadPresets, storePresets, type Preset } from "../src/shell/shop/presets";
import { claimStage, isActiveStage, previewProvider, registerPreviewProvider } from "../src/shell/shop/preview-registry";

const forSale = ITEMS.filter((i) => !i.retired && i.acquisition !== "default" && !i.season);
const ctx = { owned: new Map<string, number>(), wallet: { coins: 1000, gems: 0 } };

describe("UI-2 shop curation (editorial only, existing catalog)", () => {
  it("editor's picks and promo slides only point at existing, non-retired, non-seasonal items", () => {
    for (const id of EDITOR_PICKS) {
      const item = itemById(id);
      expect(item, id).not.toBeNull();
      expect(item!.retired).toBeFalsy();
      expect(item!.season).toBeUndefined();
    }
    const slides = promoSlides();
    expect(slides.length).toBe(COLLECTIONS.length + 1);
    for (const s of slides) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const id of s.items) expect(itemById(id)?.season, id).toBeUndefined();
      // no sale words: no discounts, bundles or deadlines are promoted
      expect(s.title + s.body + s.kicker).not.toMatch(/할인|세일|%|묶음|마감|한정/);
    }
    for (const id of ["lightning", "meadow", "bloom", "sakura", "forest", "abyss", "lava", "frost", "cosmos", "aurora"]) expect(slides.some((s) => s.collection === id)).toBe(true);
  });

  it("filters by category, tier, theme, text, ownership, currency and price band", () => {
    const dice = filterItems(forSale, { ...EMPTY_QUERY, category: "dice" }, ctx);
    expect(dice.every((i) => i.category === "dice")).toBe(true);
    expect(dice.length).toBe(34);
    expect(filterItems(forSale, { ...EMPTY_QUERY, category: "dice", tier: "common" }, ctx)).toHaveLength(6);
    const lava = filterItems(forSale, { ...EMPTY_QUERY, collection: "lava" }, ctx).map((i) => i.id).sort();
    expect(lava).toEqual(["board.volcano", "dice.lava", "emote.fire"].sort());
    expect(filterItems(forSale, { ...EMPTY_QUERY, text: "번개" }, ctx).map((i) => i.id)).toEqual(expect.arrayContaining(["dice.thunder", "board.storm", "emote.bolt"]));
    expect(matchesText(itemById("board.storm")!, "번 개")).toBe(true); // collection name, spaces ignored
    const owned = { ...ctx, owned: new Map([["dice.mint", 1]]) };
    expect(filterItems(forSale, { ...EMPTY_QUERY, own: "owned" }, owned).map((i) => i.id)).toEqual(["dice.mint"]);
    expect(filterItems(forSale, { ...EMPTY_QUERY, own: "unowned" }, owned).some((i) => i.id === "dice.mint")).toBe(false);
    expect(filterItems(forSale, { ...EMPTY_QUERY, price: "gems" }, ctx).every((i) => priceOf(i, "gems") !== null)).toBe(true);
    const afford = filterItems(forSale, { ...EMPTY_QUERY, price: "afford" }, ctx);
    expect(afford.every((i) => (priceOf(i, "coins") ?? Infinity) <= 1000)).toBe(true);
    for (const band of PRICE_BANDS.slice(1)) {
      const list = filterItems(forSale, { ...EMPTY_QUERY, band: band.value }, ctx);
      expect(list.length, band.value).toBeGreaterThan(0);
      expect(list.every((i) => sortPrice(i) >= band.min && sortPrice(i) < band.max)).toBe(true);
    }
    expect(isFiltered(EMPTY_QUERY)).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, category: "dice", sort: "name" })).toBe(false);
    expect(isFiltered({ ...EMPTY_QUERY, text: "민트" })).toBe(true);
  });

  it("sorts: recommended = editor's order first, new = newest revision, price, tier, name", () => {
    expect(SORTS.map((s) => s.value)).toEqual(["recommended", "new", "tier-desc", "tier-asc", "price-asc", "price-desc", "name"]);
    const rec = sortItems(forSale, "recommended").map((i) => i.id);
    expect(rec.slice(0, EDITOR_PICKS.length)).toEqual(EDITOR_PICKS.filter((id) => forSale.some((i) => i.id === id)));
    const fresh = sortItems(forSale, "new");
    expect(fresh[0].rev).toBe(2);
    const asc = sortItems(forSale, "price-asc").map(sortPrice);
    expect(asc).toEqual([...asc].sort((a, b) => a - b));
    const desc = sortItems(forSale.filter((i) => sortPrice(i) !== Infinity), "price-desc").map(sortPrice);
    expect(desc).toEqual([...desc].sort((a, b) => b - a));
    expect(sortItems(forSale, "tier-desc").map((i) => i.tier).filter((t) => t !== "special")[0]).toBe("mythic");
    expect(newItems(forSale).every((i) => i.rev === 2)).toBe(true);
    expect(newItems(forSale).length).toBe(11);
  });

  it("does not change prices, tiers or acquisition (sorting/filtering returns the same objects)", () => {
    const before = JSON.stringify(ITEMS);
    sortItems(filterItems(ITEMS, { ...EMPTY_QUERY, sort: "price-desc" }, ctx), "price-desc");
    expect(JSON.stringify(ITEMS)).toBe(before);
    expect(CATEGORIES).toHaveLength(9);
  });

  it("C5 achievement-only titles of a newer revision (rev 3) never become 신상품 nor sort first by 신상품순", () => {
    // Same shape as PR #140's title.streak30/100/365: special tier, achievement only, drawExcluded, rev 3.
    const streak = (id: string): typeof ITEMS[number] => ({ id, category: "title", tier: "special", specialKind: "achievement", name: id, acquisition: "achievement", rev: 3, drawExcluded: true, maxLevel: 1, look: { text: id } });
    const withC5 = [...forSale, streak("title.streak30"), streak("title.streak100"), streak("title.streak365")];
    expect(purchasable(withC5.at(-1)!)).toBe(false);
    expect(newItems(withC5).map((i) => i.id)).toEqual(newItems(forSale).map((i) => i.id)); // still the 11 rev-2 items
    const newest = sortItems(withC5, "new");
    expect(newest[0].rev).toBe(2);
    expect(newest.slice(-3).every((i) => i.acquisition === "achievement" || !purchasable(i))).toBe(true);
    expect(filterItems(withC5, { ...EMPTY_QUERY, price: "coins" }, ctx).some((i) => i.id.startsWith("title.streak"))).toBe(false);
  });

  it("collection progress counts owned items of each theme", () => {
    const p = themeProgress(new Set(["dice.thunder", "board.storm"]));
    expect(p.find((x) => x.collection.id === "lightning")).toMatchObject({ have: 2, total: 3 });
    expect(p.find((x) => x.collection.id === "lava")).toMatchObject({ have: 0 });
  });
});

describe("UI-2 loadout presets (device-local, validated like the server)", () => {
  const slots = { emote: 4, chat: 6 };
  const preset = (loadout: object): Preset => ({ id: "p1", name: "번개 세트", loadout: { ...DEFAULT_LOADOUT, ...loadout } as Preset["loadout"], at: 1 });

  it("applies a preset only through validateLoadout; unowned items fall back to defaults", () => {
    const owned = new Map([["dice.thunder", 2], ["board.storm", 1]]);
    const ok = applyPreset(preset({ dice: "dice.thunder", board: "board.storm", levels: { "dice.thunder": 2 } }), owned, slots);
    expect(ok.exact).toBe(true);
    expect(ok.loadout.dice).toBe("dice.thunder");
    const lost = applyPreset(preset({ dice: "dice.thunder", board: "board.storm" }), new Map([["board.storm", 1]]), slots);
    expect(lost.exact).toBe(false);
    expect(lost.loadout.dice).toBe(DEFAULT_LOADOUT.dice);
    expect(lost.loadout.board).toBe("board.storm");
    expect(lost.message).toContain("보유하지 않은");
    const locked = applyPreset(preset({ dice: "dice.thunder", levels: { "dice.thunder": 3 } }), new Map([["dice.thunder", 1]]), slots);
    expect(locked.exact).toBe(false);
  });

  it("stores presets per account id (never the session secret)", () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const session = "s1.u_" + "a".repeat(22) + "." + "b".repeat(43);
    const account = accountOf(session);
    expect(account).toBe("u_" + "a".repeat(22));
    expect(storePresets(account, [preset({})])).toBe(true);
    expect([...store.keys()][0]).not.toContain("b".repeat(43));
    expect(loadPresets(account)).toHaveLength(1);
    expect(loadPresets("u_other")).toHaveLength(0);
    expect(loadPresets(null)).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe("UI-2 preview registry (03 integration point)", () => {
  it("last provider per category wins; only the newest stage is active", () => {
    expect(previewProvider("dice")).toBeNull();
    const off = registerPreviewProvider({ id: "test", categories: ["dice"], thumbnail: () => "x.png" });
    expect(previewProvider("dice")?.id).toBe("test");
    expect(previewProvider("board")).toBeNull();
    off();
    expect(previewProvider("dice")).toBeNull();
    const a = claimStage();
    const b = claimStage();
    expect(isActiveStage(a)).toBe(false);
    expect(isActiveStage(b)).toBe(true);
  });
});
