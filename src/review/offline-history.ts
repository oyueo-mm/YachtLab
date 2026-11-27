import { gameDifficulties } from "../GameDifficulty";
import { categories, total } from "../engine";
import type { MatchRecord } from "../identity/records";
import { getReplay, listReplays } from "../replay-storage";
import type { Replay } from "../replay";
import { fromReplay, type ReviewSource } from "./sources";

const missing = "이 기기에 이 경기와 연결할 수 있는 기보가 없어요.";
const humanSeat = (replay: Replay) => replay.metadata.players[0].type === "human" ? 0 : 1;

function matches(record: MatchRecord, replay: Replay) {
  const seat = humanSeat(replay);
  const human = replay.metadata.players[seat];
  const opponent = replay.metadata.players[1 - seat];
  const own = replay.finalState.cards[seat];
  const difficulty = gameDifficulties.find(({ algorithm }) => algorithm === opponent.algorithm)?.name ?? opponent.algorithm;
  return record.mode === "ai" && record.endReason === "completed" &&
    replay.finalState.done && replay.initialState.actions === 0 && !replay.metadata.source &&
    human.type === "human" && opponent.type === "ai" && record.opponent.kind === "ai" &&
    human.name === record.name && !!difficulty &&
    (opponent.name === record.opponent.name || "AI · " + difficulty === record.opponent.name) &&
    total(own) === record.score && total(replay.finalState.cards[1 - seat]) === record.opponent.score &&
    categories.every((category) => own[category] === record.card[category]);
}

function matchesLegacy(record: MatchRecord, replay: Replay) {
  const algorithm = replay.metadata.players[1 - humanSeat(replay)].algorithm;
  const difficulty = gameDifficulties.find((level) => level.algorithm === algorithm)?.name ?? algorithm;
  return !!difficulty && record.aiLevel === difficulty &&
    Date.parse(replay.metadata.createdAt) === record.startedAt && matches(record, replay);
}

export function recoverLegacyReplay(record: MatchRecord, records: readonly MatchRecord[], replays: readonly Replay[]) {
  const matching = replays.filter((replay) => matchesLegacy(record, replay));
  if (matching.length !== 1) return undefined;
  const [replay] = matching;
  return records.some((other) => other.recordId !== record.recordId &&
    (other.recordId === replay.metadata.id || matchesLegacy(other, replay))) ? undefined : replay;
}

export async function offlineAIReview(record: MatchRecord, records: readonly MatchRecord[]): Promise<ReviewSource> {
  try {
    const linked = await getReplay(record.recordId);
    if (linked) return matches(record, linked) ? fromReplay(linked) : missing;
    // Old device record IDs were independent (d_...). New records cannot fall back to another replay.
    if (!record.recordId.startsWith("d_")) return missing;
    const legacy = recoverLegacyReplay(record, records, await listReplays());
    return legacy ? fromReplay(legacy) : missing;
  } catch {
    return "이 기기의 기보 저장소를 읽을 수 없어요.";
  }
}
