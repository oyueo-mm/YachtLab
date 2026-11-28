import { ActivityVisible } from "../shell/activity-visible";
import { useContext, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import "./kit.css";

/**
 * Shared UI kit (2026-11-26 polish). One look and one behaviour for the controls used across the
 * shop, settings, review and help: Select, Switch, Slider, Segmented, Sheet (modal on wide screens,
 * bottom sheet on phones), Tabs, Tooltip and Toast. Every control is keyboard reachable and exposes the
 * matching ARIA role, so screen readers and tests address them the same way as native elements.
 */

export type Option<T extends string> = { value: T; label: string; hint?: string; disabled?: boolean };

/**
 * A custom dropdown (button + listbox). Keyboard: ↑/↓/Home/End move, Enter/Space choose, Esc closes,
 * typing a letter jumps. The trigger has role "combobox" with the chosen label as its value.
 */
export function Select<T extends string>({ value, options, onChange, label, className = "", disabled = false }: {
  value: T; options: readonly Option<T>[]; onChange: (v: T) => void; label: string; className?: string; disabled?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const current = options.find((o) => o.value === value) ?? options[0];
  const [up, setUp] = useState(false);
  const [maxListHeight, setMaxListHeight] = useState<number>();
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside, true);
    return () => document.removeEventListener("pointerdown", outside, true);
  }, [open]);
  useLayoutEffect(() => {
    const anchor = trigger.current;
    if (!open || !anchor) return;
    const scroller = anchor.closest("[data-select-viewport]");
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const bounds = scroller?.getBoundingClientRect();
      const below = (bounds?.bottom ?? window.innerHeight) - r.bottom;
      const above = r.top - (bounds?.top ?? 0);
      const opensUp = below < 260 && above > below;
      setUp(opensUp);
      setMaxListHeight(bounds ? Math.max(0, Math.min(280, (opensUp ? above : below) - 8)) : undefined);
    };
    place();
    scroller?.addEventListener("scroll", place, { passive: true });
    window.addEventListener("resize", place);
    return () => {
      scroller?.removeEventListener("scroll", place);
      window.removeEventListener("resize", place);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const menu = list.current;
    const option = menu?.children.item(active) as HTMLElement | null | undefined;
    if (!menu || !option) return;
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
    }
  }, [open, active, maxListHeight]);
  const move = (from: number, step: number) => {
    let i = from;
    for (let n = 0; n < options.length; n++) {
      i = (i + step + options.length) % options.length;
      if (!options[i].disabled) return i;
    }
    return from;
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
    trigger.current?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    const k = e.key;
    if (!open && (k === "ArrowDown" || k === "ArrowUp" || k === "Enter" || k === " ")) {
      e.preventDefault();
      setActive(Math.max(0, options.findIndex((o) => o.value === value)));
      setOpen(true);
      return;
    }
    if (!open) return;
    if (k === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (k === "ArrowDown") {
      e.preventDefault();
      setActive((a) => move(a, 1));
    } else if (k === "ArrowUp") {
      e.preventDefault();
      setActive((a) => move(a, -1));
    } else if (k === "Home") {
      e.preventDefault();
      setActive(move(-1, 1));
    } else if (k === "End") {
      e.preventDefault();
      setActive(move(options.length, -1));
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      choose(active);
    } else if (k === "Tab") setOpen(false);
    else if (k.length === 1) {
      const i = options.findIndex((o, j) => j > active && o.label.startsWith(k)) ;
      const j = i >= 0 ? i : options.findIndex((o) => o.label.startsWith(k));
      if (j >= 0) setActive(j);
    }
  };
  return (
    <div ref={root} className={"ui-select" + (open ? " open" : "") + (className ? " " + className : "")} data-value={value}>
      <button ref={trigger} type="button" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        aria-activedescendant={open ? `${id}-${active}` : undefined} disabled={disabled}
        onClick={() => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen((v) => !v); }} onKeyDown={onKey}>
        <span className="ui-select-value">{current?.label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <ul ref={list} id={id} role="listbox" aria-label={label} className={"ui-select-list" + (up ? " up" : "")} style={{ maxHeight: maxListHeight }}>
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
              className={(i === active ? "active" : "") + (o.disabled ? " disabled" : "")}
              onPointerEnter={() => !o.disabled && setActive(i)} onClick={() => choose(i)}>
              <span>
                {o.label}
                {o.hint && <small>{o.hint}</small>}
              </span>
              {o.value === value && <Check size={15} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** On/off switch (role="switch"). */
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      className={"ui-switch" + (checked ? " on" : "")} onClick={() => onChange(!checked)}>
      <span className="ui-switch-knob" aria-hidden="true" />
    </button>
  );
}

/** Range slider with a filled track (native input underneath: keyboard, touch and AT work as usual). */
export function Slider({ value, onChange, label, min = 0, max = 100, step = 1, disabled = false, format }: {
  value: number; onChange: (v: number) => void; label: string; min?: number; max?: number; step?: number; disabled?: boolean; format?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <span className={"ui-slider" + (disabled ? " disabled" : "")}>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled}
        aria-valuetext={format ? format(value) : undefined}
        style={{ ["--fill" as string]: `${pct}%` }} onChange={(e) => onChange(Number(e.target.value))} />
      <output aria-hidden="true">{format ? format(value) : value}</output>
    </span>
  );
}

/** Segmented control (radio group); ←/→ move the choice. */
export function Segmented<T extends string>({ value, options, onChange, label, className = "" }: {
  value: T; options: readonly Option<T>[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    for (let n = 1; n <= options.length; n++) {
      const j = (i + step * n + options.length) % options.length;
      if (!options[j].disabled) {
        onChange(options[j].value);
        refs.current[j]?.focus();
        return;
      }
    }
  };
  return (
    <div role="radiogroup" aria-label={label} className={"ui-segmented" + (className ? " " + className : "")}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1} disabled={o.disabled} title={o.hint}
          className={o.value === value ? "active" : ""} onClick={() => onChange(o.value)} onKeyDown={(e) => onKey(e, i)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Modal dialog: centred on wide screens, a bottom sheet on phones (≤ 640 px). Esc and a click on the
 * backdrop close it; focus moves into it on open and back to the opener on close (native <dialog>).
 */
export function Sheet({ open, onClose, title, children, className = "", labelledBy }: {
  open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; className?: string; labelledBy?: string;
}) {
  const visible = useContext(ActivityVisible);
  const ref = useRef<HTMLDialogElement>(null);
  const headId = useId();
  const opener = useRef<Element | null>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && visible && !d.open) {
      opener.current = document.activeElement;
      setClosing(false);
      d.showModal?.();
    }
    if ((!open || !visible) && d.open) {
      d.close();
      (opener.current as HTMLElement | null)?.focus?.();
    }
  }, [open, visible]);
  const close = useCallback(() => onClose(), [onClose]);
  return (
    <dialog ref={ref} className={"ui-sheet" + (closing ? " closing" : "") + (className ? " " + className : "")} aria-labelledby={labelledBy ?? headId}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="ui-sheet-body">
        <span className="ui-sheet-grip" aria-hidden="true" />
        <div className="ui-sheet-head">
          <h2 id={headId}>{title}</h2>
          <button type="button" className="icon-button" aria-label={`${typeof title === "string" ? title : ""} 닫기`.trim()} onClick={close}>
            <X size={19} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Tabs (tablist with ←/→). Panels are rendered by the caller with the returned ids. */
export function Tabs<T extends string>({ value, options, onChange, label, className = "" }: {
  value: T; options: readonly Option<T>[]; onChange: (v: T) => void; label: string; className?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label={label} className={"ui-tabs" + (className ? " " + className : "")}>
      {options.map((o, i) => (
        <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" aria-selected={o.value === value} tabIndex={o.value === value ? 0 : -1}
          className={o.value === value ? "active" : ""} disabled={o.disabled} onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            const j = (i + step + options.length) % options.length;
            onChange(options[j].value);
            refs.current[j]?.focus();
          }}>
          {o.label}
          {o.hint && <small>{o.hint}</small>}
        </button>
      ))}
    </div>
  );
}

/** Small hover / focus tooltip. */
export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="ui-tooltip" aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="ui-tooltip-bubble">{text}</span>
    </span>
  );
}

/* ---------------------------------------------------------------- toast ---------------------------------------------------------------- */
type ToastItem = { id: number; text: string };
let toasts: ToastItem[] = [];
let toastSeq = 0;
const toastListeners = new Set<() => void>();
/** Short status message at the bottom of the screen (e.g. "효과음 꺼짐" from a shortcut). */
export function toast(text: string, ms = 1600) {
  const id = ++toastSeq;
  toasts = [...toasts.filter((t) => t.text !== text), { id, text }].slice(-3);
  toastListeners.forEach((fn) => fn());
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id);
    toastListeners.forEach((fn) => fn());
  }, ms);
}
export function ToastHost() {
  const [, set] = useState(0);
  useEffect(() => {
    const fn = () => set((n) => n + 1);
    toastListeners.add(fn);
    return () => { toastListeners.delete(fn); };
  }, []);
  return (
    <div className="ui-toasts" role="status" aria-live="polite">
      {toasts.map((t) => <span key={t.id} className="ui-toast">{t.text}</span>)}
    </div>
  );
}
