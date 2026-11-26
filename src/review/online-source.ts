import type { PublicLook } from "../economy/live/catalog";
import type { Card } from "../engine";
import type { OnlineEvent } from "../online/protocol";
import type { PlayerView } from "../online/server-engine";
import type { Position, ReviewMatch, Situation } from "./model";

export const missingOnlineReview = "이 경기에는 양쪽의 전체 굴림과 점수 기록이 저장되지 않았어요.";

export function fromOnline(view: PlayerView, history: readonly OnlineEvent[], looks?: Record<string, PublicLook>): ReviewMatch | string {
  if (view.status !== "finished" || !view.you) return "완료한 본인 경기에서 리뷰할 수 있어요.";
  if (view.players.length !== 2) return "1:1 경기를 분석할 수 있어요.";
  const ordered = [...history].sort((a, b) => a.seq - b.seq);
  if (ordered[0]?.type !== "matchCreated" || ordered.at(-1)?.type !== "matchFinished" ||
      ordered.some((event, index) => event.seq !== index + ordered[0].seq)) return missingOnlineReview;
  const playerIds = view.players.map((player) => player.playerId);
  const cards: [Card, Card] = [{}, {}];
  const positions: [Position | null, Position | null] = [null, null];
  const simultaneously = view.mode === "simultaneous";
  const visibleCards = (): [Card, Card] => [{ ...cards[0] }, { ...cards[1] }];
  let round = 1;
  const steps: Situation[] = [];
  for (const event of ordered) {
    if (event.type === "turnStarted" || event.type === "roundStarted") {
      positions[0] = positions[1] = null;
      round = event.round;
    }
    if (event.type === "diceRolled") {
      const seat = playerIds.indexOf(event.playerId);
      if (seat < 0) return missingOnlineReview;
      const next: Position = {
        cards: visibleCards(),
        ...(simultaneously ? { simultaneous: true } : {}),
        dice: event.dice.map((value, id) => ({ value, id, held: event.kept.includes(id) })),
        rolls: event.roll, round, player: seat === 0 ? 0 : 1,
      };
      const position = positions[seat];
      if (position) steps.push({ before: { ...position, cards: visibleCards(), dice: position.dice.map((die) => ({ ...die, held: event.kept.includes(die.id) })) },
        action: { type: "reroll", ids: [...event.kept] }, afterRoll: next });
      positions[seat] = next;
    }
    if (event.type === "categoryScored") {
      const seat = playerIds.indexOf(event.playerId);
      if (seat < 0) return missingOnlineReview;
      const position = positions[seat];
      if (position && !event.auto) steps.push({ before: { ...position, cards: visibleCards() }, action: { type: "score", category: event.category } });
      cards[seat][event.category] = event.points;
      positions[seat] = null;
    }
  }
  if (!steps.length) return "분석할 확정 행동이 없어요.";
  return { id: view.matchId, players: [view.players[0].name, view.players[1].name], scores: [view.players[0].total, view.players[1].total],
    ...(looks ? { looks: [looks[playerIds[0]], looks[playerIds[1]]] } : {}), winners: view.winners.map((winner) => winner === playerIds[0] ? 0 : 1),
    me: view.you.playerId === playerIds[0] ? 0 : 1, steps };
}
