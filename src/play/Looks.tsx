import { itemById, type PublicLook } from "../economy/live/catalog";
import { useSettings } from "../settings";

/**
 * How a player's equipped items look on other screens: profile icon, nickname effect, title.
 * Everything comes from the server's validated look (never from what a client claims). The viewer
 * can turn other players' showy effects off (settings: 상대 효과 줄이기); the name stays readable.
 */
export function PlayerTag({ name, look, me = false, compact = false }: { name: string; look?: PublicLook | null; me?: boolean; compact?: boolean }) {
  const { opponentFx } = useSettings();
  const icon = itemById(look?.profile)?.look.text ?? "";
  const fx = itemById(look?.nameFx)?.look.css ?? "";
  const lv = look?.nameFxLv ?? 1;
  const title = itemById(look?.title)?.look.text ?? "";
  const showFx = fx && (me || opponentFx);
  return (
    <span className={"player-tag" + (compact ? " compact" : "")}>
      {icon && (
        <span className="player-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      <span className={"player-name" + (showFx ? ` ${fx} fx-lv${lv}` : "")}>{name}</span>
      {title && !compact && <span className="player-title">{title}</span>}
    </span>
  );
}

/** Dice colours of a look (current turn's player), for the 2D and 3D dice. */
export function diceLookOf(look?: PublicLook | null) {
  return itemById(look?.dice)?.look.dice ?? null;
}
/** Board colour of a look ("" = the default charcoal). */
export function boardOf(look?: PublicLook | null) {
  return itemById(look?.board)?.look.board ?? "";
}
