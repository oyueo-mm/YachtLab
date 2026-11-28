import { clearScoreFx } from "../score-fx";
import { useEffect, useRef, useState } from "react";
import { Dices, Play, Volume2 } from "lucide-react";
import { collectionsOf } from "../economy/live/collections";

import { EmoteGlyph } from "../play/EmoteGlyph";
import { CATEGORIES, itemById, lookAt, publicLook, DEFAULT_LOADOUT, type ItemDef, type PublicLook } from "../economy/live/catalog";
import { TIERS } from "../economy/live/config";
import { paintFace } from "../dice3d/face-paint";
import { boardTheme, DefaultAvatar, PlayerTag } from "../play/Looks";
import { FxBurst, GLYPH, type FxKind } from "../play/FxBurst";
import { ChatMessage } from "../play/ChatMessage";
import { useOwnLook } from "../play/own-look";
import { GUEST_LOOK } from "../economy/live/catalog";
import { socialItem } from "../social/catalog";
import { playEmoteSfx, unlockAudio } from "../sound";
import { DieIcon } from "../Dice";
import { useSettings } from "../settings";
import { claimStage, isActiveStage, onStageChange, previewProvider } from "./shop/preview-registry";
import { PreviewStage, type PreviewStageHandle } from "./shop/PreviewStage";
// INT-1 (UI-2 §6.4): dice cards upgrade to FX-1 static 3D stills (one shared offscreen renderer).
import "./shop/fx1-stills";

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
export function DiceFace({ item, level, size = 64, value = 5 }: { item: ItemDef; level: number; size?: number; value?: number }) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const look = lookAt(item, level).dice;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !look) return;
    const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
    c.width = c.height = px;
    paintFace(c.getContext("2d")!, value, px, look);
  }, [JSON.stringify(look), size, value]);
  return <canvas ref={canvas} className={"dice-face-thumb" + (look?.glow ? " glow" : "") + (look?.anim ? " anim" : "")} style={{ width: size, height: size, ["--glow" as string]: look?.glow ?? "transparent" }} aria-hidden="true" />;
}

/** Small sample of an item for cards and lists (what other players will see). */
export function ItemThumb({ item, level = 1, size = 64 }: { item: ItemDef; level?: number; size?: number }) {
  const { ref, inView } = useInView<HTMLSpanElement>();
  const look = lookAt(item, level);
  const provider = previewProvider(item.category);
  const [still, setStill] = useState<string | null>(null);
  const px = Math.round(size * 2);
  useEffect(() => {
    // Async stills (FX-1): requested once the card is on screen; the 2D image stays until then.
    if (!inView || !provider?.thumbnailAsync) return;
    let alive = true;
    provider.thumbnailAsync(item, level, px).then((url) => alive && url && setStill(url)).catch(() => {});
    return () => { alive = false; };
  }, [inView, provider, item.id, level, px]);
  const image = provider?.thumbnail?.(item, level) ?? still;
  let body: React.ReactNode = null;
  if (image) body = inView ? <img className="item-thumb-still" src={image} alt="" width={size} height={size} loading="lazy" decoding="async" /> : null;
  else if (item.category === "dice") body = inView ? <DiceFace item={item} level={level} size={size} /> : null;
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
    // The default effect ("기본 연출") has no particles: it used to dereference `look.fx` and crash the whole
    // inventory's 특수 연출 tab (UI-2). It now shows a plain "no extra effect" sample.
    body = look.fx ? (
      <span className={"fx-sample fx-shape-" + look.fx.shape} aria-hidden="true">
        {look.fx.colors.concat(look.fx.colors).slice(0, 5).map((c, i) => (
          <i key={i} style={{ background: GLYPH[look.fx!.shape] ? undefined : c, color: c }}>
            {GLYPH[look.fx!.shape] ?? ""}
          </i>
        ))}
      </span>
    ) : <span className="fx-sample fx-none">기본</span>;
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


/**
 * The large preview in the item detail: the real game piece at the chosen level. Nothing is saved.
 */
export function ItemStage({ item, level, name = "내 닉네임", partnerId }: { item: ItemDef; level: number; name?: string; partnerId?: string | null }) {
  const look = lookAt(item, level);
  // Single active stage (preview-registry): the newest stage owns the token; an older one goes static.
  const [token] = useState(claimStage);
  const [active, setActive] = useState(true);
  useEffect(() => onStageChange(() => setActive(isActiveStage(token))), [token]);
  const [pairOwn, setPairOwn] = useState(!!partnerId);
  const stage = useRef<PreviewStageHandle>(null);
  const [replay, setReplay] = useState(0);
  const [pair, setPair] = useState(false);
  const [bubbleLine, setBubbleLine] = useState(0);
  const [fxKind, setFxKind] = useState<FxKind>("win");
  const own = useOwnLook();
  const reduced = useSettings().reducedEffects;
  // Preview sounds follow the global settings (mute / effects switch / volume); no extra switch.
  useEffect(() => {
    if (item.category === "board") return clearScoreFx;
  }, [item]);
  // Switching level replays the emote (dice / boards: the preview stage throws again by itself).
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
  }, [level, item.category]);
  if (item.category === "dice" || item.category === "board") {
    // Collection combo preview: the same theme's die on its board, with the synergy (nothing is saved).
    const collection = item.category === "dice" || item.category === "board" ? collectionsOf(item.id).find((c) => c.dice.length && c.boards.length) : undefined;
    // "My equipped piece": the board under this die / the die on this board, from what the player wears
    // (or the inventory's chosen partner). Default pieces are not offered (that is the plain preview).
    const ownPartnerId = partnerId ?? (item.category === "dice" ? own?.board : own?.dice);
    const ownPartner = ownPartnerId ? itemById(ownPartnerId) : null;
    const ownChoice = ownPartner && ownPartner.acquisition !== "default" && ownPartner.category !== item.category ? ownPartner : null;
    const partner = pair && collection ? itemById(item.category === "dice" ? collection.boards[0] : collection.dice[0]) : pairOwn && ownChoice ? ownChoice : null;
    const provider = previewProvider(item.category);
    if (provider?.Stage) return <div className="item-stage"><provider.Stage item={item} level={level} partner={partner} active={active} /></div>;
    const boardItem = item.category === "board" ? item : partner;
    const diceItem = item.category === "dice" ? item : partner;
    // The pair is shown at the chosen level on both sides (the game uses the lower of the two levels).
    const lv = (other: ItemDef | null) => (other ? (other === item ? level : Math.min(level, other.maxLevel)) : 1);
    return (
      <div className="item-stage">
        {/* One stage with the FxPreview interface (FX-1): dice table, board layers, synergy and moments. */}
        <PreviewStage ref={stage} dice={diceItem?.id ?? null} diceLevel={lv(diceItem)} board={boardItem?.id ?? null} boardLevel={lv(boardItem)} autoRoll={item.category === "dice" || level === 3} />
        {collection && (
          <label className="stage-pair">
            <input type="checkbox" checked={pair} onChange={(e) => { setPair(e.target.checked); if (e.target.checked) setPairOwn(false); }} />
            <span><b>{collection.name} 컬렉션 조합 미리보기</b> · {collection.synergy}</span>
          </label>
        )}
        {ownChoice && !(collection && (collection.dice.includes(ownChoice.id) || collection.boards.includes(ownChoice.id)) && pair) && (
          <label className="stage-pair-own">
            <input type="checkbox" checked={pairOwn && !pair} onChange={(e) => { setPairOwn(e.target.checked); if (e.target.checked) setPair(false); }} />
            <span><b>내 {ownChoice.category === "board" ? "보드판" : "주사위"}({ownChoice.name})과 함께 보기</b></span>
          </label>
        )}
        <div className="stage-actions">
          <button type="button" className="primary stage-action" onClick={() => stage.current?.roll()}>
            <Dices size={17} /> 굴려 보기
          </button>
          <button type="button" className="secondary stage-action" onClick={() => {
            // material click on this board's surface, then the settle — the two sounds a throw is made of
            stage.current?.playSound("impact");
            window.setTimeout(() => stage.current?.playSound("land"), 260);
          }}><Volume2 size={15} /> 소리 듣기</button>
          {item.category === "board" && level === 3 && <button type="button" className="secondary stage-action" onClick={() => stage.current?.scoreFx("large")}>족보 반응</button>}
        </div>
        <div className="stage-chips stage-moments" role="group" aria-label="경기 연출 미리보기">
          <button type="button" onClick={() => stage.current?.moment("yacht")}>요트 연출</button>
          <button type="button" onClick={() => stage.current?.moment("straight")}>스트레이트 연출</button>
          <button type="button" onClick={() => stage.current?.moment("win")}>{item.category === "board" ? "승리 반응" : "승리 연출"}</button>
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
          {item.category === "emote" && item.maxLevel > 1 && (
            <button type="button" className="secondary stage-action" onClick={() => {
              unlockAudio();
              // Lv.1 → Lv.2 → Lv.3 one after another, so the difference is heard directly.
              [1, 2, 3].forEach((lv, n) => window.setTimeout(() => playEmoteSfx(item.id, lv), n * 950));
            }}><Volume2 size={15} /> Lv.1~3 효과음 비교</button>
          )}
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
  if (item.category === "fx") {
    return (
      <div className="item-stage">
        <div className="stage-result stage-fx-none" role="img" aria-label="기본 연출 미리보기">
          <strong>승리했습니다!</strong>
          <small>추가 입자 효과 없이 결과만 보여 줘요.</small>
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
