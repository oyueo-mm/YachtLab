import { diceMaterial } from "../sound-packs";
import { itemById, lookAt, type ItemDef, type PublicLook } from "../economy/live/catalog";
import type { CSSProperties } from "react";
import { motionLevel, useSettings } from "../settings";

/**
 * How a player's equipped items look on other screens: profile icon (with frame), nickname effect,
 * title. Everything comes from the server's validated look (never from what a client claims). The
 * viewer can turn other players' showy effects off (settings: 상대 효과 줄이기); the name stays readable.
 */
/** Seat colours: me = brand red, 1:1 opponent = blue, more players get further distinct hues. */
export type PlayerTone = "me" | "opp" | "p3" | "p4" | "p5" | "p6" | "p7" | "p8";
export function toneOf(seatIndex: number, mine: boolean, meIndex: number): PlayerTone {
  if (mine) return "me";
  // Order the other seats after mine so the first opponent is always blue.
  const others = seatIndex > meIndex ? seatIndex - 1 : seatIndex;
  return (["opp", "p3", "p4", "p5", "p6", "p7", "p8"] as const)[others % 7];
}

/** The neutral account picture: a grey person silhouette in a circle (no item, or the default one). */
export function DefaultAvatar() {
  return (
    <svg className="default-avatar" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#c5cad2" />
      <circle cx="12" cy="9.4" r="4.3" fill="#f3f4f6" />
      <path d="M3.6 20.6C5 16.9 8.2 14.9 12 14.9s7 2 8.4 5.7A12 12 0 0 1 12 24a12 12 0 0 1-8.4-3.4Z" fill="#f3f4f6" />
    </svg>
  );
}

/**
 * A player's profile picture: the equipped profile item, or the default silhouette. Separate from the
 * dice skin. `tone` draws the seat colour ring (me / opponent) so seats differ by more than colour alone.
 */
export function ProfileAvatar({ look, me = false, tone, size }: { look?: PublicLook | null; me?: boolean; tone?: PlayerTone; size?: number }) {
  const { opponentFx } = useSettings();
  const profile = lookAt(itemById(look?.profile), look?.profileLv ?? 1);
  const icon = profile.text ?? "";
  const showFx = me || opponentFx;
  const style = size ? ({ fontSize: size * 0.62, width: size, height: size } as CSSProperties) : undefined;
  return (
    <span className={"player-icon" + (icon ? "" : " is-default") + (showFx && profile.css ? " " + profile.css : "") + (tone ? " tone-" + tone : "")} style={style} aria-hidden="true">
      {icon || <DefaultAvatar />}
    </span>
  );
}

export function PlayerTag({ name, look, me = false, compact = false, tone }: { name: string; look?: PublicLook | null; me?: boolean; compact?: boolean; tone?: PlayerTone }) {
  const { opponentFx } = useSettings();
  const fx = itemById(look?.nameFx)?.look.css ?? "";
  const lv = look?.nameFxLv ?? 1;
  const titleItem = itemById(look?.title);
  const title = titleItem?.look.text ?? "";
  const showFx = me || opponentFx;
  return (
    <span className={"player-tag" + (compact ? " compact" : "") + (tone ? " tone-" + tone : "")}>
      <ProfileAvatar look={look} me={me} tone={tone} />
      <span className={"player-name" + (fx && showFx ? ` ${fx} fx-lv${lv}` : "")}>{name}</span>
      {title && !compact && <span className={"player-title" + (titleItem?.look.css ? " " + titleItem.look.css : "")} data-title={titleItem?.id}>{title}</span>}
    </span>
  );
}

/** Dice look of a player (current turn's player), for the 2D and 3D dice — at the level they chose. */
export function diceLookOf(look?: PublicLook | null, showEffects = true) {
  return lookAt(itemById(look?.dice), showEffects ? look?.diceLv ?? 1 : 1).dice ?? null;
}
export function diceMaterialOf(look?: PublicLook | null) {
  return diceMaterial(look?.dice, diceLookOf(look));
}
/** The same frame, tray and shelf style in the game and in item previews. */
export function boardTheme(item: ItemDef | null | undefined, level = 1, motion = true) {
  if (!item || item.category !== "board") return { className: "" };
  const look = lookAt(item, level);
  const classic = item.id === "board.navy" ? "bd-navy" : item.id === "board.felt" ? "bd-felt" : "bd-charcoal";
  return {
    className: ` board-themed ${look.css ?? classic}${motion ? "" : " bd-static"}`,
    style: { "--board-color": look.board || "var(--table)" } as CSSProperties,
  };
}

export function useBoardTheme(look?: PublicLook | null) {
  const settings = useSettings();
  return boardTheme(itemById(look?.board), look?.boardLv, motionLevel(settings) === "full");
}
/** Bubble class (feed messages) at the chosen level. */
export function bubbleCssOf(look?: PublicLook | null) {
  return lookAt(itemById(look?.bubble), look?.bubbleLv ?? 1).css ?? "";
}
