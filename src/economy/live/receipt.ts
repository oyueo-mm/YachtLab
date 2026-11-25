/** A presentation-only receipt for one server-verified match. The ledger is authoritative. */
export type MatchReceipt = {
  before: { coins: number; gems: number };
  after: { coins: number; gems: number };
  quests: { id: string; previous: number; progress: number; done: boolean }[];
  grants: { kind: string; label: string; coins: number; gems: number }[];
};
