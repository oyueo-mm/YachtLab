/**
 * Loadout presets (UI-2, 2026-11-28) — DEVICE-LOCAL ONLY. There is no account sync yet: presets are kept in
 * this browser per account id and are not visible on another device. The server contract for a future sync
 * is docs/context/UI-2-SHOP-INVENTORY.md §프리셋 서버 계약.
 *
 * A preset is only ever a *draft*: applying one runs the same `validateLoadout` the server runs (ownership,
 * categories, slot caps, unlocked levels). Anything no longer valid is dropped by `sanitizeLoadout` and the
 * player is told. Nothing changes on the server until "장착 저장", which the server validates again.
 */
import { sanitizeLoadout, validateLoadout, type Loadout, type Owned, type Slots } from "../../economy/live/catalog";

export const MAX_PRESETS = 5;
export type Preset = { id: string; name: string; loadout: Loadout; at: number };

const KEY = "yachtlab.loadout-presets.v1:";
/** The account part of a session token (`s1.<account>.<secret>`), never the secret. */
export const accountOf = (session: string | null) => (session ? session.split(".")[1] ?? null : null);

export function loadPresets(account: string | null): Preset[] {
  if (!account) return [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY + account) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is Preset => !!p && typeof p.id === "string" && typeof p.name === "string" && typeof p.loadout === "object" && p.loadout !== null)
      .slice(0, MAX_PRESETS)
      .map((p) => ({ ...p, name: p.name.slice(0, 20) }));
  } catch {
    return [];
  }
}
export function storePresets(account: string | null, presets: Preset[]) {
  if (!account) return false;
  try {
    localStorage.setItem(KEY + account, JSON.stringify(presets.slice(0, MAX_PRESETS)));
    return true;
  } catch {
    return false;
  }
}

export type Applied = { loadout: Loadout; exact: boolean; message: string };
/** Validate a preset against what the player owns now (same rules as the server). */
export function applyPreset(preset: Preset, owned: Owned, slots: Slots): Applied {
  const checked = validateLoadout(preset.loadout, owned, slots);
  if (checked.ok) return { loadout: checked.loadout, exact: true, message: `‘${preset.name}’ 프리셋을 불러왔어요. ‘장착 저장’을 눌러야 적용돼요.` };
  return {
    loadout: sanitizeLoadout(preset.loadout, owned, slots),
    exact: false,
    message: `‘${preset.name}’ 일부를 지금은 장착할 수 없어 기본값으로 바꿨어요(${checked.message}). ‘장착 저장’을 눌러야 적용돼요.`,
  };
}
