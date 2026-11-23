import { cryptoDiceSource, type DiceSource } from "./dice-source";
import { parseCommand, type CommandResult, type OnlineMatchState } from "./protocol";
import { applyCommand, createOnlineMatch, viewFor, type MatchOptions, type PlayerView } from "./server-engine";

/**
 * In-memory host for one match: the boundary a future transport/storage adapter wraps
 * (one instance per match, commands handled one at a time). It has no network or platform dependency;
 * Phase 1 uses it only in tests and local simulations.
 */
export class OnlineMatchHost {
  private current: OnlineMatchState;

  constructor(
    options: MatchOptions,
    private readonly clock: () => number = Date.now,
    private readonly dice: DiceSource = cryptoDiceSource(),
    initial?: OnlineMatchState,
  ) {
    this.current = initial ?? createOnlineMatch(options, clock());
  }

  get state(): OnlineMatchState {
    return this.current;
  }

  /** `playerId` must come from the authenticated connection, not from the message body. */
  handle(raw: unknown, playerId: string): CommandResult {
    const parsed = parseCommand(raw, playerId);
    if (!parsed.ok) return parsed;
    const result = applyCommand(this.current, parsed.command, { now: this.clock(), dice: this.dice });
    if (result.ok) this.current = result.state;
    return result;
  }

  view(viewerId: string | null, sinceSeq?: number): PlayerView {
    return viewFor(this.current, viewerId, this.clock(), sinceSeq);
  }
}
