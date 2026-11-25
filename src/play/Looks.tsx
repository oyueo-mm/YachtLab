import { itemById, lookAt, type ItemDef, type PublicLook } from "../economy/live/catalog";
import type { CSSProperties } from "react";
import { motionLevel, useSettings } from "../settings";

/**
 * How a player's equipped items look on other screens: profile icon (with frame), nickname effect,
 * title. Everything comes from the server's validated look (never from what a client claims). The
 * viewer can turn other players' showy effects off (settings: 상대 효과 줄이기); the name stays readable.
 */
export function PlayerTag({ name, look, me = false, compact = false }: { name: string; look?: PublicLook | null; me?: boolean; compact?: boolean }) {
  const { opponentFx } = useSettings();
  const profile = lookAt(itemById(look?.profile), look?.profileLv ?? 1);
  const icon = profile.text ?? "";
  const fx = itemById(look?.nameFx)?.look.css ?? "";
  const lv = look?.nameFxLv ?? 1;
  const titleItem = itemById(look?.title);
  const title = titleItem?.look.text ?? "";
  const showFx = me || opponentFx;
  return (
    <span className={"player-tag" + (compact ? " compact" : "")}>
      {icon && (
        <span className={"player-icon" + (showFx && profile.css ? " " + profile.css : "")} aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={"player-name" + (fx && showFx ? ` ${fx} fx-lv${lv}` : "")}>{name}</span>
      {title && !compact && <span className={"player-title" + (titleItem?.look.css ? " " + titleItem.look.css : "")}>{title}</span>}
    </span>
  );
}

/** Dice look of a player (current turn's player), for the 2D and 3D dice — at the level they chose. */
export function diceLookOf(look?: PublicLook | null) {
  return lookAt(itemById(look?.dice), look?.diceLv ?? 1).dice ?? null;
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
