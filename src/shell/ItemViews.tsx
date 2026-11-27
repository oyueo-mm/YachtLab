import { announceScore, clearScoreFx } from "../score-fx";
import { diceMaterial } from "../sound-packs";
import { useEffect, useRef, useState } from "react";
import { Dices, Play, Volume2 } from "lucide-react";
import { BoardFx, SynergyFx } from "../play/BoardFx";
import { collectionsOf } from "../economy/live/collections";

import { EmoteGlyph } from "../play/EmoteGlyph";
import { emitFx } from "../fx-bus";
import { CATEGORIES, itemById, lookAt, publicLook, DEFAULT_LOADOUT, type ItemDef, type PublicLook } from "../economy/live/catalog";
import { TIERS } from "../economy/live/config";
import { paintFace } from "../dice3d/face-paint";
import { DiceArea } from "../DiceArea";
import { boardTheme, DefaultAvatar, PlayerTag } from "../play/Looks";
import { FxBurst, GLYPH, type FxKind } from "../play/FxBurst";
import { ChatMessage } from "../play/ChatMessage";
import { useOwnLook } from "../play/own-look";
import { GUEST_LOOK } from "../economy/live/catalog";
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
  } else if (item.category === "emote") body = <span className="emote-sample"><EmoteGlyph id={item.id} text={look.text ?? ""} level={inView ? Math.min(level, 2) : 1} /></span>;
  else if (item.category === "chat") body = <span className="feed-msg chat sample">{look.text}</span>;
  else if (item.category === "bubble")
    body = (
      <span className={"feed-msg chat sample " + (look.css ?? "")}>
        <b className="feed-from">친구</b> 안녕하세요!
      </span>
    );
  else if (item.category === "profile") body = <span className={"player-icon big " + (look.text ? "" : "is-default ") + (look.css ?? "")}>{look.text || <DefaultAvatar />}</span>;
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
function lookWith(item: ItemDef, level: number, equipped?: PublicLook | null): PublicLook {
  // Cosmetic slots that are shown together (nickname + title + frame) start from what the player wears.
  const base = equipped ?? publicLook(DEFAULT_LOADOUT, new Map());
  const slot = item.category;
  const lv = Math.max(1, Math.min(level, item.maxLevel));
  if (slot === "emote") return { ...base, emotes: [{ id: item.id, lv }] };
  if (slot === "chat") return { ...base, chats: [item.id] };
  return { ...base, [slot]: item.id, [slot + "Lv"]: lv } as PublicLook;
}

/** Sample lines for the bubble preview: one calm, one cheering, one questioning (never the live catalog). */
const BUBBLE_LINES = ["안녕하세요!", "대단해요!", "정말요?"].map((text, i) => ({ id: "chat.hello", item: { id: "preview.line." + i, kind: "chat" as const, text, label: text, tier: "basic" as const, style: "default" as const } }));

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
  const [pair, setPair] = useState(false);
  const [bubbleLine, setBubbleLine] = useState(0);
  const [fxKind, setFxKind] = useState<FxKind>("win");
  const own = useOwnLook();
  const reduced = useSettings().reducedEffects;
  const boardRef = useRef<HTMLElement | null>(null);
  // Preview sounds follow the global settings (mute / effects switch / volume); no extra switch.
  const previewGrand = () => {
    unlockAudio();
    const example = [1, 2, 3, 4, 5].map((value, id) => ({ value, id, held: false }));
    setDice(example);
    setRolls(1);
    announceScore(example, "large");
    emitFx({ type: "straight" });
  };
  const previewWin = () => {
    unlockAudio();
    emitFx({ type: "win" });
  };
  useEffect(() => {
    if (item.category === "board") return clearScoreFx;
  }, [item]);
  const roll = () => {
    unlockAudio();
    setDice((previous) => randomDice().map((die, index) => previous[index].held ? previous[index] : die));
    setRolls((r) => (r >= 3 ? 1 : r + 1));
    setRollEvent((n) => n + 1);
  };
  // Switching level replays the throw so Lv.1 / Lv.2 / Lv.3 can be compared directly.
  const firstLevel = useRef(true);
  useEffect(() => {
    if (firstLevel.current) {
      firstLevel.current = false;
      return;
    }
    if (item.category === "emote") {
      setReplay((n) => n + 1);
      playEmoteSfx(item.id, level);
    }
    // Dice: every level re-throws. Boards: Lv.2 is visible at rest; Lv.3 throws so the reactions show.
    if ((item.category === "dice" || (item.category === "board" && level === 3)) && motionLevel() === "full") {
      setDice((d) => d.map((x) => ({ ...x, held: false })));
      setRolls((r) => (r >= 3 ? 1 : r + 1));
      setRollEvent((n) => n + 1);
    }
  }, [level, item.category]);
  const state = { dice, order: [0, 1, 2, 3, 4], rolls: Math.max(1, rolls) };
  // The real 3D table when the device can draw it (the same renderer and painter as in a match).
  const settings = useSettings();
  const renderer = diceRenderer(settings);
  if (item.category === "dice" || item.category === "board") {
    // Collection combo preview: the same theme's die on its board, with the synergy (nothing is saved).
    const collection = item.category === "dice" || item.category === "board" ? collectionsOf(item.id).find((c) => c.dice.length && c.boards.length) : undefined;
    const partner = pair && collection ? itemById(item.category === "dice" ? collection.boards[0] : collection.dice[0]) : null;
    const boardItem = item.category === "board" ? item : partner;
    const diceItem = item.category === "dice" ? item : partner;
    // The pair is shown at the chosen level on both sides (the game uses the lower of the two levels).
    const partnerLv = (other: ItemDef) => Math.min(level, other.maxLevel);
    const diceLook = diceItem ? lookAt(diceItem, diceItem === item ? level : partnerLv(diceItem)).dice ?? null : null;
    const theme = boardItem ? boardTheme(boardItem, boardItem === item ? level : partnerLv(boardItem), motionLevel(settings) === "full") : { className: "" };
    return (
      <div className="item-stage">
        <section ref={boardRef} className={"game-board throw-tray stage-board" + theme.className} style={theme.style} aria-label="미리보기 보드">
          <DiceArea key={partner?.id ?? "solo"} state={state} forceRenderer={renderer} colors={diceLook} material={diceMaterial(diceItem?.id ?? item.id, diceLook ?? undefined)} interactive animate rollEvent={rollEvent} onToggle={(id) => setDice((previous) => previous.map((die) => die.id === id ? { ...die, held: !die.held } : die))} />
          {boardItem && <BoardFx itemId={boardItem.id} level={boardItem === item ? level : partnerLv(boardItem)} host={boardRef} />}
          {partner && diceItem && boardItem && <SynergyFx dice={diceItem.id} board={boardItem.id} level={level} host={boardRef} />}
        </section>
        {collection && (
          <label className="stage-pair">
            <input type="checkbox" checked={pair} onChange={(e) => setPair(e.target.checked)} />
            <span><b>{collection.name} 컬렉션 조합 미리보기</b> · {collection.synergy}</span>
          </label>
        )}
        <div className="stage-actions">
          <button type="button" className="primary stage-action" onClick={roll}>
            <Dices size={17} /> 굴려 보기
          </button>
          {item.category === "board" && level === 3 && <>
            <button type="button" className="secondary stage-action" onClick={previewGrand}>족보 반응</button>
            <button type="button" className="secondary stage-action" onClick={previewWin}>승리 반응</button>
          </>}
        </div>
      </div>
    );
  }
  if (item.category === "emote" || item.category === "chat" || item.category === "bubble") {
    const sample = BUBBLE_LINES[bubbleLine];
    const s = item.category === "bubble" ? socialItem(sample.id) : socialItem(item.id);
    const css = item.category === "bubble" ? (look.css ?? "") : "";
    const lv = item.category === "emote" ? level : 1;
    return (
      <div className="item-stage">
        <div className="stage-feed">
          <div className="table-feed">
            {s && <ChatMessage key={replay} item={item.category === "bubble" ? sample.item : s} from="친구" bubbleCss={css} level={lv} effects={!reduced} staticMode={reduced} />}
          </div>
          {item.category === "bubble" && (
            <div className="stage-chips" role="group" aria-label="미리볼 문구">
              {BUBBLE_LINES.map((l, i) => <button key={l.id} type="button" aria-pressed={i === bubbleLine} onClick={() => { setBubbleLine(i); setReplay((n) => n + 1); }}>{l.item.text}</button>)}
            </div>
          )}
        </div>
        <div className="stage-actions">
          <button type="button" className="primary stage-action" onClick={() => {
            unlockAudio();
            setReplay((n) => n + 1);
            if (item.category === "emote" || (s && s.style !== "default")) playEmoteSfx(item.id, lv);
          }}>
            <Play size={15} /> 다시 보기
          </button>
        </div>
      </div>
    );
  }
  if (item.category === "fx" && look.fx) {
    const kinds: { id: FxKind; label: string; min: number }[] = [
      { id: "win", label: "승리", min: 1 },
      { id: "yacht", label: "요트", min: 2 },
      { id: "large", label: "라지 스트레이트", min: 2 },
    ];
    const shown = kinds.filter((k) => item.maxLevel === 1 ? k.id === "win" : true);
    const active = fxKind === "win" || level >= 2 ? fxKind : "win";
    return (
      <div className="item-stage">
        <div className={"stage-result stage-fx-" + active} role="img" aria-label={`${kinds.find((k) => k.id === active)?.label} 연출 미리보기`}>
          <FxBurst key={replay} fx={look.fx} level={level} seed={`preview-${item.id}-${replay}`} sound={replay > 0} kind={active} />
          {active === "win" ? <strong>승리했습니다!</strong> : active === "yacht" ? <strong>요트!</strong> : <strong className="stage-large"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span></strong>}
          <small>{level >= 3 ? "전용 효과음 포함" : ""}</small>
        </div>
        {shown.length > 1 && (
          <div className="stage-chips" role="group" aria-label="연출 종류">
            {shown.map((k) => <button key={k.id} type="button" aria-pressed={k.id === active} disabled={level < k.min} onClick={() => { setFxKind(k.id); setReplay((n) => n + 1); }}>{k.label}{level < k.min ? " (Lv.2~)" : ""}</button>)}
          </div>
        )}
        <div className="stage-actions">
          <button type="button" className="primary stage-action" onClick={() => {
            unlockAudio();
            setReplay((n) => n + 1);
          }}><Play size={15} /> 연출 재생</button>
        </div>
      </div>
    );
  }
  // profile, nickname effect, title: the player card exactly as others see it, worn with the rest of
  // what the player has equipped (frame + nickname effect + title read together).
  const worn = lookWith(item, level, own);
  return (
    <div className="item-stage">
      <div className="profile-card-sample">
        <PlayerTag name={name} look={worn} me />
        <small>{own && own !== GUEST_LOOK ? "지금 장착한 다른 꾸미기와 함께 보여요." : "상대 화면과 관전 화면에 이렇게 보여요."}</small>
      </div>
      <div className="profile-card-seat" aria-hidden="true"><PlayerTag name={name} look={worn} me tone="me" compact /></div>
    </div>
  );
}

/**
 * Level comparison for upgradable items: each level with what it adds; choosing one previews it at once
 * (never changes what is equipped). Locked levels can be previewed too.
 */
export function LevelTabs({ item, level, setLevel, unlocked }: { item: ItemDef; level: number; setLevel: (lv: number) => void; unlocked?: number }) {
  if (item.maxLevel <= 1) return null;
  const lvls = Array.from({ length: item.maxLevel }, (_, i) => i + 1);
  return (
    <div className="level-tabs" role="tablist" aria-label="강화 단계 비교">
      {lvls.map((lv) => (
        <button key={lv} type="button" role="tab" aria-selected={level === lv} className={level === lv ? "active" : ""}
          onClick={() => setLevel(lv)}
          onKeyDown={(e) => {
            const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!step) return;
            e.preventDefault();
            e.stopPropagation();
            setLevel(Math.max(1, Math.min(item.maxLevel, lv + step)));
          }}>
          <b>Lv.{lv}{unlocked !== undefined && lv > unlocked && <small> 잠김</small>}</b>
          {item.levels?.[lv - 1] && <span>{item.levels[lv - 1]}</span>}
        </button>
      ))}
    </div>
  );
}
export { itemById };
