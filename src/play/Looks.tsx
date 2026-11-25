import { itemById, lookAt, type PublicLook } from "../economy/live/catalog";
import { useSettings } from "../settings";

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
/** Board colour of a look ("" = the default charcoal). */
export function boardOf(look?: PublicLook | null) {
  return itemById(look?.board)?.look.board ?? "";
}
/** Board pattern class (felt, wood, marble, space…) at the chosen level ("" = none). */
export function boardCssOf(look?: PublicLook | null) {
  return lookAt(itemById(look?.board), look?.boardLv ?? 1).css ?? "";
}
/** Bubble class (feed messages) at the chosen level. */
export function bubbleCssOf(look?: PublicLook | null) {
  return lookAt(itemById(look?.bubble), look?.bubbleLv ?? 1).css ?? "";
}
