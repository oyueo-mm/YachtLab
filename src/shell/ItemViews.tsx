import { announceScore, clearScoreFx } from "../score-fx";
import { diceMaterial } from "../sound-packs";
import { useEffect, useRef, useState } from "react";
import { Dices, Play, Volume2 } from "lucide-react";
import { CATEGORIES, itemById, lookAt, publicLook, DEFAULT_LOADOUT, type ItemDef, type PublicLook } from "../economy/live/catalog";
import { TIERS } from "../economy/live/config";
import { paintFace } from "../dice3d/face-paint";
import { DiceArea } from "../DiceArea";
import { boardTheme, PlayerTag } from "../play/Looks";
import { FxBurst, GLYPH } from "../play/FxBurst";
import { socialItem } from "../social/catalog";
import { playEmoteSfx, playSfx, unlockAudio } from "../sound";
import { DieIcon } from "../Dice";
import { diceRenderer, motionLevel, useSettings } from "../settings";

/**
 * Item visuals for the shop and the inventory (E/F/G, 2026-11-25).
 *  - Card thumbnails are cheap: a canvas-painted die face (the same painter as the 3D dice), CSS samples
 *    for boards / bubbles / names / frames, the emoji itself. Animated samples pause while off screen.
 *  - The detail preview (`ItemStage`) uses the real game pieces: the dice table (3D when available)
 *    with a throw button, the game board, the chat feed bubble, the player tag, the special-effect
 *    burst and its sound. A preview never equips anything and never touches a game.
 */
export const tierLabel = (t: string) => TIERS.find((x) => x.id === t)?.label ?? t;
export const categoryLabel = (c: string) => CATEGORIES.find((x) => x.id === c)?.label ?? c;

/** True while the element is (nearly) on screen — used to start canvases and pause animations. */
export function useInView<T extends Element>(margin = "120px") {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") return setInView(true);
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [margin]);
  return { ref, inView };
}

/** One painted die face (value 5) of a dice item at a level. */
function DiceFace({ item, level, size = 64 }: { item: ItemDef; level: number; size?: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const look = lookAt(item, level).dice;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !look) return;
    const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
    c.width = c.height = px;
    paintFace(c.getContext("2d")!, 5, px, look);
  }, [JSON.stringify(look), size]);
  return <canvas ref={canvas} className={"dice-face-thumb" + (look?.glow ? " glow" : "") + (look?.anim ? " anim" : "")} style={{ width: size, height: size, ["--glow" as string]: look?.glow ?? "transparent" }} aria-hidden="true" />;
}

/** Small sample of an item for cards and lists (what other players will see). */
export function ItemThumb({ item, level = 1 }: { item: ItemDef; level?: number }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const look = lookAt(item, level);
  let body: React.ReactNode = null;
  if (item.category === "dice") body = inView ? <DiceFace item={item} level={level} /> : null;
  else if (item.category === "board") {
    const theme = boardTheme(item, level, false);
    body = (
      <span className={"board-sample" + theme.className} style={theme.style}>
        <DieIcon value={5} />
        <DieIcon value={3} />
      </span>
    );
  } else if (item.category === "emote") body = <span className={`emote-sample emote-lv${level}`}>{look.text}</span>;
  else if (item.category === "chat") body = <span className="feed-msg chat sample">{look.text}</span>;
  else if (item.category === "bubble")
    body = (
      <span className={"feed-msg chat sample " + (look.css ?? "")}>
        <b className="feed-from">친구</b> 안녕하세요!
      </span>
    );
  else if (item.category === "profile") body = <span className={"player-icon big " + (look.css ?? "")}>{look.text || "🙂"}</span>;
  else if (item.category === "nameFx") body = <span className={`player-name ${look.css ?? ""} fx-lv${level}`}>닉네임</span>;
  else if (item.category === "fx")
    body = (
      <span className={"fx-sample fx-shape-" + (look.fx?.shape ?? "confetti")} aria-hidden="true">
        {(look.fx?.colors ?? ["#ddd"]).concat(look.fx?.colors ?? []).slice(0, 5).map((c, i) => (
          <i key={i} style={{ background: GLYPH[look.fx!.shape] ? undefined : c, color: c }}>
            {GLYPH[look.fx!.shape] ?? ""}
          </i>
        ))}
      </span>
    );
  else if (item.category === "title") body = look.text ? <span className={"player-title " + (look.css ?? "")}>{look.text}</span> : <span className="item-none">없음</span>;
  return (
    <span ref={ref} className={"item-thumb cat-" + item.category + (inView ? "" : " offscreen")}>
      {body}
    </span>
  );
}

/** A look that shows exactly this item (everything else default) — for previews. */
function lookWith(item: ItemDef, level: number): PublicLook {
  const base = publicLook(DEFAULT_LOADOUT, new Map());
  const slot = item.category;
  const lv = Math.max(1, Math.min(level, item.maxLevel));
  if (slot === "emote") return { ...base, emotes: [{ id: item.id, lv }] };
  if (slot === "chat") return { ...base, chats: [item.id] };
  return { ...base, [slot]: item.id, [slot + "Lv"]: lv } as PublicLook;
}

const randomDice = () => Array.from({ length: 5 }, (_, id) => ({ id, value: 1 + Math.floor(Math.random() * 6), held: false }));

/**
 * The large preview in the item detail: the real game piece at the chosen level. Nothing is saved.
 */
export function ItemStage({ item, level, name = "내 닉네임" }: { item: ItemDef; level: number; name?: string }) {
  const look = lookAt(item, level);
  const [dice, setDice] = useState(randomDice);
  const [rolls, setRolls] = useState(0);
  const [rollEvent, setRollEvent] = useState(0);
  const [replay, setReplay] = useState(0);
  const previewGrand = () => {
    unlockAudio();
    const example = [1, 2, 3, 4, 5].map((value, id) => ({ value, id, held: false }));
    setDice(example);
    setRolls(1);
    announceScore(example, "large");
  };
  useEffect(() => {
    if (item.category === "board") return clearScoreFx;
  }, [item]);
  const roll = () => {
    unlockAudio();
    setDice((previous) => randomDice().map((die, index) => previous[index].held ? previous[index] : die));
    setRolls((r) => Math.min(3, r + 1));
    setRollEvent((n) => n + 1);
  };
  const state = { dice, order: [0, 1, 2, 3, 4], rolls: Math.max(1, rolls) };
  // The real 3D table when the device can draw it (the same renderer and painter as in a match).
  const settings = useSettings();
  const renderer = diceRenderer(settings);
  if (item.category === "dice" || item.category === "board") {
    const theme = item.category === "board" ? boardTheme(item, level, motionLevel(settings) === "full") : { className: "" };
    return (
      <div className="item-stage">
        <section className={"game-board throw-tray stage-board" + theme.className} style={theme.style} aria-label="미리보기 보드">
          <DiceArea state={state} forceRenderer={renderer} colors={item.category === "dice" ? (look.dice ?? null) : null} material={diceMaterial(item.id, look.dice)} interactive animate rollEvent={rollEvent} onToggle={(id) => setDice((previous) => previous.map((die) => die.id === id ? { ...die, held: !die.held } : die))} />
        </section>
        <div className="stage-actions">
          <button type="button" className="primary stage-action" onClick={roll}>
            <Dices size={17} /> 굴려 보기
          </button>
          {item.category === "board" && level === 3 &&
            <button type="button" className="secondary stage-action" onClick={previewGrand}>족보 효과 보기</button>}
        </div>
      </div>
    );
  }
  if (item.category === "emote" || item.category === "chat" || item.category === "bubble") {
    const s = item.category === "bubble" ? socialItem("chat.hello") : socialItem(item.id);
    const css = item.category === "bubble" ? (look.css ?? "") : "";
    const lv = item.category === "emote" ? level : 1;
    return (
      <div className="item-stage">
        <div className="stage-feed">
          <div className="table-feed">
            <span key={replay} className={"feed-msg " + (s?.kind ?? "chat") + (css ? " " + css : "") + (s?.kind === "emote" ? ` emote-lv${lv}` : "") + (s && s.style !== "default" ? ` social-${s.style}` : "")}>
              <b className="feed-from">친구</b>
              <span className="feed-text">{s?.text}</span>
            </span>
          </div>
          <p className="stage-note">경기 중 메시지가 이렇게 보여요{item.category === "bubble" ? " (말풍선은 내가 보내는 모든 메시지에 적용)" : ""}.</p>
        </div>
        <div className="stage-actions">
          <button type="button" className="secondary" onClick={() => setReplay((n) => n + 1)}>
            <Play size={15} /> 다시 보기
          </button>
          {(item.category === "emote" || s && s.style !== "default") && (
            <button type="button" className="secondary" onClick={() => {
              unlockAudio();
              setReplay((n) => n + 1);
              playEmoteSfx(item.id);
            }}>
              <Volume2 size={15} /> 소리 듣기
            </button>
          )}
        </div>
      </div>
    );
  }
  if (item.category === "fx" && look.fx) {
    return (
      <div className="item-stage">
        <div className="stage-result" role="img" aria-label="승리 연출 미리보기">
          <FxBurst key={replay} fx={look.fx} level={level} seed={`preview-${item.id}-${replay}`} sound={replay > 0} />
          <strong>승리했습니다!</strong>
          <small>{level >= 2 ? "요트를 기록할 때도 나와요" : "승리하면 나와요"}{level >= 3 ? " · 전용 효과음" : ""}</small>
        </div>
        <button type="button" className="primary stage-action" onClick={() => (unlockAudio(), setReplay((n) => n + 1))}>
          <Play size={15} /> 연출 재생
        </button>
      </div>
    );
  }
  // profile, nickname effect, title: the player card exactly as others see it
  return (
    <div className="item-stage">
      <div className="profile-card-sample">
        <PlayerTag name={name} look={lookWith(item, level)} me />
        <small>상대 화면과 관전 화면에 이렇게 보여요.</small>
      </div>
    </div>
  );
}

/** Level tabs (Lv.1–3) for upgradable items: previewing a level never changes what is equipped. */
export function LevelTabs({ item, level, setLevel, unlocked }: { item: ItemDef; level: number; setLevel: (lv: number) => void; unlocked?: number }) {
  if (item.maxLevel <= 1) return null;
  return (
    <div className="level-tabs" role="tablist" aria-label="단계 미리보기">
      {Array.from({ length: item.maxLevel }, (_, i) => i + 1).map((lv) => (
        <button key={lv} type="button" role="tab" aria-selected={level === lv} className={level === lv ? "active" : ""} onClick={() => setLevel(lv)}>
          Lv.{lv}
          {unlocked !== undefined && lv > unlocked && <small> 잠김</small>}
        </button>
      ))}
    </div>
  );
}
export { itemById };
