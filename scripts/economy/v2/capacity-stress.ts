/** Isolated chronological room-admission stress study, with a shared UTC capacity ledger. */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { baselineParams } from "../../../src/economy/v2/params";
import { POLICIES } from "../../../src/economy/v2/candidates";
import { economyDay } from "../../../src/economy/live/config";
import { mulberry32 } from "../../../src/economy/rng";

const UNITS = 86_400_000;
const MINUTE = 60_000;
const KST_START = Date.UTC(2026, 10, 29, 15);
const studyDays = 7;
const BASE = baselineParams();
const AI_ROOMS = 100;
const ALL_ROOMS = 300;
const LIVE = 50;
type Request = { at: number; user: number | null; window: "early" | "late" | "long" | "other"; duration: number; order: number };
type Limit = "account" | "aiGlobal" | "allGlobal" | "concurrent";
type Counts = { attempts: number; admitted: number; account: number; aiGlobal: number; allGlobal: number; concurrent: number };
const counts = (): Counts => ({ attempts: 0, admitted: 0, account: 0, aiGlobal: 0, allGlobal: 0, concurrent: 0 });
const add = (map: Map<number, number>, key: number) => map.set(key, (map.get(key) ?? 0) + 1);

function tape(n: number, other: number): Request[] {
  const r = mulberry32(878593101 + n);
  const requests: Request[] = [];
  const emit = (at: number, user: Request["user"], window: Request["window"], duration: number) =>
    requests.push({ at, user, window, duration, order: requests.length });
  for (let day = 0; day < studyDays; day++) {
    const kst = KST_START + day * UNITS;
    for (let u = 0; u < n; u++) {
      const window = u % 12 === 0 ? "long" : u % 3 === 0 ? "early" : "late";
      const count = window === "long" ? 40 : 3 + Math.floor(r() * 5);
      let start = (window === "early" ? 6 : window === "late" ? 20 : 0) * 60 + r() * 55;
      for (let i = 0; i < count; i++) {
        const duration = Math.round(7 + 6 * r());
        emit(kst + start * MINUTE, u, window, duration);
        start += duration + 1 + 3 * r();
      }
    }
    for (let i = 0; i < other; i++) emit(kst + r() * UNITS, null, "other", 6 + 22 * r());
  }
  return requests.sort((a, b) => a.at - b.at || a.order - b.order);
}

function simulate(requests: Request[], global: boolean) {
  const groups = { early: counts(), late: counts(), long: counts(), other: counts() };
  const users = new Map<number, Map<number, number>>();
  const ais = new Map<number, number>();
  const rooms = new Map<number, number>();
  let live: number[] = [];
  const accepted: Request[] = [];
  for (const req of requests) {
    const g = groups[req.window];
    g.attempts++;
    const utc = Math.floor(req.at / UNITS);
    let rejected: Limit | undefined;
    if (req.user !== null) {
      const byDay = users.get(req.user) ?? new Map<number, number>();
      users.set(req.user, byDay);
      const kst = economyDay(req.at);
      if ((byDay.get(kst) ?? 0) === BASE.daily.aiStarts) rejected = "account";
      else add(byDay, kst); // Worker charges the account attempt before requesting a directory room.
    }
    live = live.filter((end) => end > req.at);
    if (!rejected && global) {
      if ((rooms.get(utc) ?? 0) >= ALL_ROOMS) rejected = "allGlobal";
      else if (req.user !== null && (ais.get(utc) ?? 0) >= AI_ROOMS) rejected = "aiGlobal";
      else if (live.length >= LIVE) rejected = "concurrent";
    }
    if (rejected) {
      g[rejected]++;
      continue;
    }
    g.admitted++;
    live.push(req.at + req.duration * MINUTE);
    add(rooms, utc);
    if (req.user !== null) {
      add(ais, utc);
      accepted.push(req);
    }
  }

  const guaranteedWinsUpper = Object.fromEntries([BASE, ...POLICIES].map((p) => {
    const rewarded = new Map<string, number>();
    const grantRows = accepted.map((req) => ({ ...req, end: req.at + req.duration * MINUTE }))
      .sort((a, b) => a.end - b.end || a.order - b.order);
    let coins = 0;
    for (const req of grantRows) {
      const key = req.user + "|" + economyDay(req.end);
      const position = (rewarded.get(key) ?? 0) + 1;
      rewarded.set(key, position);
      coins += position <= p.daily.fullMatches ? p.match.ai.complete + p.match.ai.win
        : position <= p.daily.reducedUntil ? p.daily.reducedCoins : 0;
    }
    return [p.id, coins];
  }));
  return { groups, aisPerUTCDate: Object.fromEntries(ais), roomsPerUTCDate: Object.fromEntries(rooms), guaranteedWinsUpper };
}
const out = {
  days: studyDays, seed: "878593101 + player count", limits: { aiPerUTCDate: AI_ROOMS, totalPerUTCDate: ALL_ROOMS, live: LIVE, accountPerKstDate: BASE.daily.aiStarts },
  rows: [12, 40, 120].flatMap((users) => [50, 250].map((otherPerDay) => {
    const requests = tape(users, otherPerDay);
    return { users, otherPerDay, accountOnly: simulate(requests, false), shared: simulate(requests, true) };
  })),
};
writeFileSync(resolve(process.argv[2] ?? "docs/economy/v2/codex/shared-capacity.json"), JSON.stringify(out, null, 1) + "\n");
