import { MAX_SOLO_RECORDS, sanitizeSoloRecord, type SoloRecord } from "./records";
import { session } from "../identity/account-client";

/** The signed-in account id (u_…) or null for a guest. */
export const soloOwner = () => session()?.split(".")[1] ?? null;

/** Browser storage of 1인 플레이 records (this device). */

const KEY = "yachtlab.solo-records.v1";
export const newSoloRecordId = () => "s_" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[b & 63]).join("");

/** Every record on this device (all owners). */
export function allSoloRecords(): SoloRecord[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(list) ? list.map((r) => sanitizeSoloRecord(r)).filter((r): r is SoloRecord => !!r) : [];
  } catch {
    return [];
  }
}
/** The records of whoever is using the site now: the account's own, or the guest's (no owner). */
export function soloRecords(owner: string | null = soloOwner()): SoloRecord[] {
  return allSoloRecords().filter((r) => (r.owner ?? null) === owner);
}
function write(list: SoloRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.sort((a, b) => b.endedAt - a.endedAt).slice(0, MAX_SOLO_RECORDS)));
  } catch {
    /* storage full or blocked: the game itself still finished */
  }
  window.dispatchEvent(new Event("yachtlab-solo-records"));
}
export function saveSoloRecord(record: SoloRecord) {
  const owner = soloOwner();
  write([{ ...record, ...(owner ? { owner } : {}) }, ...allSoloRecords().filter((r) => r.recordId !== record.recordId)]);
}
/** Merge records from the account (same id = same game; never duplicated). */
export function mergeSoloRecords(records: SoloRecord[], owner: string) {
  const map = new Map(allSoloRecords().map((r) => [r.recordId, r]));
  let added = 0;
  for (const r of records) {
    const clean = sanitizeSoloRecord(r);
    if (!clean) continue;
    if (!map.has(clean.recordId)) added++;
    const replayId = map.get(clean.recordId)?.replayId;
    map.set(clean.recordId, { ...clean, owner, ...(replayId ? { replayId } : {}) });
  }
  if (added) write([...map.values()]);
  return added;
}
export function clearSoloRecords() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event("yachtlab-solo-records"));
}

