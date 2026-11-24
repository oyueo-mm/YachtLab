import type { MatchRecord } from "./records";

/**
 * This browser's guest identity and match records (Phase 4). Nothing here needs a server.
 *
 *  - guestKey: 32 random bytes, kept only in this browser. It proves "these records came from this
 *    device" when a guest later links them to an account (the server stores only its hash).
 *  - guestId: derived from the key (SHA-256), shown nowhere but used as the import identity.
 *  - The nickname is a label only (`yachtlab.online.name`, shared with online play).
 *  - Records are capped (most recent 500). Clearing site data deletes all of it: the profile says so.
 * Three different credentials, three purposes: seat tokens (one online seat), the guest key (device
 * records), the account session (sign-in). None of them is ever put in a URL.
 */
const GUEST_KEY = "yachtlab.guest.v1";
const RECORDS_KEY = "yachtlab.records.v1";
const IMPORTED_KEY = "yachtlab.records.imported.v1";
export const MAX_LOCAL_RECORDS = 500;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
};

export type Guest = { key: string; createdAt: number };
export function guest(): Guest {
  const existing = read<Guest | null>(GUEST_KEY, null);
  if (existing && typeof existing.key === "string" && existing.key.length >= 40) return existing;
  const fresh = { key: b64url(crypto.getRandomValues(new Uint8Array(32))), createdAt: Date.now() };
  write(GUEST_KEY, fresh);
  return fresh;
}
export async function guestIdOf(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("yachtlab-guest:" + key)));
  return "g_" + b64url(digest).slice(0, 22);
}

export const newRecordId = () => "d_" + b64url(crypto.getRandomValues(new Uint8Array(12)));

export function localRecords(): MatchRecord[] {
  const list = read<MatchRecord[]>(RECORDS_KEY, []);
  return Array.isArray(list) ? list : [];
}
/** Add a finished game (idempotent by recordId). */
export function saveLocalRecord(record: MatchRecord) {
  const list = localRecords().filter((r) => r.recordId !== record.recordId);
  list.push(record);
  list.sort((a, b) => a.endedAt - b.endedAt);
  write(RECORDS_KEY, list.slice(-MAX_LOCAL_RECORDS));
  window.dispatchEvent(new Event("yachtlab-records"));
}
/** Records already linked to an account from this device (so they are not offered again). */
export const importedIds = (): Set<string> => new Set(read<string[]>(IMPORTED_KEY, []));
export function markImported(ids: string[]) {
  const all = importedIds();
  ids.forEach((id) => all.add(id));
  write(IMPORTED_KEY, [...all].slice(-2000));
}
export function clearLocalData() {
  for (const k of [RECORDS_KEY, IMPORTED_KEY]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}
