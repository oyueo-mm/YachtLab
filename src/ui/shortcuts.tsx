import { useContext, useEffect, useRef, useState } from "react";
import { categories, names, score, type Category, type Die } from "../engine";
import { getSettings, updateSettings, useSettings } from "../settings";
import { unlockAudio } from "../sound";
import { ActivityVisible } from "../shell/activity-visible";
import { Sheet, toast } from "./kit";

/**
 * Keyboard shortcuts (PC). One window listener; screens register their own keys with a hook and the
 * most recently mounted screen wins. Game keys run the same callbacks as the buttons (the same checks:
 * my turn, not animating, rolls left), so nothing new can reach the engine through the keyboard.
 *
 * Never handled: keys with Ctrl / Alt / Meta (browser shortcuts), keys typed into inputs, text areas,
 * selects, contenteditable elements or open listboxes, and auto-repeat of action keys (holding Space
 * rolls once). Dialogs and popups keep game shortcuts away from the underlying page.
 */
type Handler = (e: KeyboardEvent) => boolean;
const stack: { id: number; handler: Handler; inDialog: boolean }[] = [];
let seq = 0;

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el || !el.closest) return false;
  if (el.isContentEditable) return true;
  return !!el.closest("input:not([type=range]):not([type=checkbox]):not([type=radio]), textarea, select, [contenteditable=''], [contenteditable=true], [role=listbox], [role=combobox][aria-expanded=true]");
}
const modalOpen = () => typeof document !== "undefined" && !!document.querySelector("dialog[open]");
/** Review / replay screens are dialogs themselves; any other open dialog (settings, confirm) blocks them. */
const otherDialogOpen = () => typeof document !== "undefined" && !!document.querySelector("dialog[open]:not(.review-page):not(.replay-modal)");

const HELP_EVENT = "yachtlab-shortcut-help";
export const openShortcutHelp = () => window.dispatchEvent(new Event(HELP_EVENT));

function toggleFullscreen() {
  if (!document.fullscreenEnabled) return;
  if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
  else void document.documentElement.requestFullscreen?.().catch(() => undefined);
}

let installed = false;
export function installShortcuts() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (document.querySelector("[role=dialog]:not(dialog):not([inert] *)")) return;
    const s = getSettings();
    if (!s.shortcuts) return;
    // Screen keys first (topmost registration).
    {
      const modal = modalOpen(), other = otherDialogOpen();
      for (let i = stack.length - 1; i >= 0; i--) {
        const layer = stack[i];
        if (modal && (!layer.inDialog || other)) continue;
        if (layer.handler(e)) {
          e.preventDefault();
          document.documentElement.classList.add("kbd-mode");
          return;
        }
      }
    }
    if (e.repeat) return;
    const k = e.key;
    if (k === "?" || (k === "/" && e.shiftKey)) {
      e.preventDefault();
      openShortcutHelp();
    } else if (modalOpen()) return;
    else if (k === "m" || k === "M" || k === "ㅡ") {
      updateSettings({ muted: !s.muted });
      unlockAudio();
      toast(s.muted ? "소리 켜짐" : "전체 음소거");
    } else if (k === "b" || k === "B" || k === "ㅠ") {
      updateSettings({ bgm: !s.bgm });
      unlockAudio();
      toast(s.bgm ? "배경 음악 꺼짐" : "배경 음악 켜짐");
    } else if (k === "f" || k === "F" || k === "ㄹ") {
      toggleFullscreen();
    }
  });
  // Any pointer use hides the keyboard hints on dice again.
  window.addEventListener("pointerdown", () => document.documentElement.classList.remove("kbd-mode"), { capture: true, passive: true });
}

/** Register screen keys while `enabled`. The handler returns true when it used the key. */
export function useShortcutLayer(handler: Handler, enabled = true, inDialog = false) {
  const visible = useContext(ActivityVisible);
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled || !visible) return;
    const id = ++seq;
    stack.push({ id, handler: (e) => ref.current(e), inDialog });
    return () => {
      const i = stack.findIndex((x) => x.id === id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [enabled, visible]);
}

export type GameKeys = {
  /** It is my turn and nothing is animating (the same condition that enables the buttons). */
  active: boolean;
  dice: readonly Die[];
  rolls: number;
  canRoll: boolean;
  roll: () => void;
  /** Toggle one die (by id). */
  toggle: (id: number) => void;
  /** Hold every die / release every die. */
  setAll: (held: boolean) => void;
  /** Categories that can still be scored by me. */
  open: readonly Category[];
  record: (c: Category) => void;
};

/**
 * Game keys: Space roll · 1–5 hold/release (die numbers, as read by screen readers and shown on the
 * dice in keyboard mode) · A hold all · D release all · ↑/↓ choose a category · Enter record it ·
 * Esc cancel the choice. Returns the category chosen with the arrows (shown on the score sheet).
 * The choice never records by itself: a second key (Enter) is needed, and it resets after each roll.
 */
export function useGameShortcuts(g: GameKeys) {
  const [picked, setPicked] = useState<Category | null>(null);
  const { shortcuts } = useSettings();
  const ref = useRef(g);
  ref.current = g;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  // A new roll, a new turn or losing the turn clears the choice.
  useEffect(() => setPicked(null), [g.rolls, g.active]);
  useShortcutLayer((e) => {
    const s = ref.current;
    const k = e.key;
    const action = !e.repeat;
    if (k === "Escape" && pickedRef.current) {
      setPicked(null);
      return true;
    }
    if (!s.active) return false;
    if (k === " " || k === "Spacebar") {
      if ((e.target as HTMLElement | null)?.closest?.("button, a, [role=button], [role=switch], [role=tab], [role=radio]")) return false;
      if (action && s.canRoll) s.roll();
      return true;
    }
    if (s.rolls === 0 || s.rolls > 3) return false;
    if (/^[1-5]$/.test(k)) {
      if (action && s.rolls < 3) {
        const id = Number(k) - 1;
        if (s.dice.some((d) => d.id === id)) s.toggle(id);
      }
      return true;
    }
    if (k === "a" || k === "A" || k === "ㅁ") {
      if (action && s.rolls < 3) s.setAll(true);
      return true;
    }
    if (k === "d" || k === "D" || k === "ㅇ") {
      if (action && s.rolls < 3) s.setAll(false);
      return true;
    }
    if (k === "ArrowDown" || k === "ArrowUp") {
      const list = categories.filter((c) => s.open.includes(c));
      if (!list.length) return false;
      if (e.repeat) return true;
      const cur = pickedRef.current ? list.indexOf(pickedRef.current) : -1;
      const next = cur < 0 ? (k === "ArrowDown" ? 0 : list.length - 1) : (cur + (k === "ArrowDown" ? 1 : -1) + list.length) % list.length;
      setPicked(list[next]);
      return true;
    }
    if (k === "Enter") {
      const c = pickedRef.current;
      if ((e.target as HTMLElement | null)?.closest?.("button, a")) return false;
      if (!c || !action) return !!c;
      setPicked(null);
      if (s.open.includes(c)) s.record(c);
      return true;
    }
    return false;
  }, shortcuts);
  const preview = picked ? score(g.dice.map((d) => d.value), picked) : 0;
  return { picked, setPicked, preview, label: picked ? `${names[picked]} ${preview}점 · Enter로 기록` : "" };
}

/** Review / replay keys: ←/→ step, Home/End jump, Space play/pause. */
export function useReviewShortcuts(r: { prev: () => void; next: () => void; first: () => void; last: () => void; toggle?: () => void }, enabled = true) {
  const ref = useRef(r);
  ref.current = r;
  useShortcutLayer((e) => {
    const s = ref.current;
    switch (e.key) {
      case "ArrowLeft": s.prev(); return true;
      case "ArrowRight": s.next(); return true;
      case "Home": s.first(); return true;
      case "End": s.last(); return true;
      case " ":
        if (!s.toggle) return false;
        if ((e.target as HTMLElement | null)?.closest?.("button, a, [role=tab], [role=switch]")) return false;
        if (!e.repeat) s.toggle();
        return true;
      default: return false;
    }
  }, enabled, true);
}

const GROUPS: { title: string; keys: [string, string][] }[] = [
  { title: "게임", keys: [["Space", "주사위 굴리기"], ["1–5", "주사위 고정·해제 (주사위 번호)"], ["A", "모두 고정"], ["D", "모두 해제"], ["↑ ↓", "기록할 족보 고르기"], ["Enter", "고른 족보 기록"], ["Esc", "선택 취소·창 닫기"]] },
  { title: "게임 리뷰", keys: [["← →", "이전·다음 행동"], ["Space", "자동 재생·일시 정지"], ["Home", "첫 행동"], ["End", "마지막 행동"]] },
  { title: "공통", keys: [["M", "전체 음소거"], ["B", "배경 음악 켜기·끄기"], ["F", "전체 화면"], ["?", "단축키 안내"]] },
];

/** The "?" help sheet (rendered once by the app shell). */
export function ShortcutHelpHost() {
  const [open, setOpen] = useState(false);
  const { shortcuts } = useSettings();
  useEffect(() => {
    const fn = () => setOpen(true);
    window.addEventListener(HELP_EVENT, fn);
    return () => window.removeEventListener(HELP_EVENT, fn);
  }, []);
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title="키보드 단축키" className="shortcut-help">
      {!shortcuts && <p className="settings-note">단축키가 꺼져 있어요. 설정 → 조작에서 켤 수 있어요.</p>}
      <div className="shortcut-groups">
        {GROUPS.map((g) => (
          <section key={g.title}>
            <h3>{g.title}</h3>
            <dl>
              {g.keys.map(([k, v]) => (
                <div key={k}>
                  <dt>{k.split(" ").map((p, i) => <kbd key={i}>{p}</kbd>)}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="settings-note">입력창에서는 동작하지 않고, 상대 차례나 주사위가 구르는 동안에는 게임 키가 무시돼요.</p>
    </Sheet>
  );
}
