import { AccountError, api } from "../identity/account-client";
import type { SoloRecord } from "./records";
import { mergeSoloRecords, soloOwner, soloRecords } from "./storage";

/**
 * Account copy of 1인 플레이 records (members). Guests keep records on this device only.
 * Upload is idempotent (record id) and only sends records the account has not acknowledged yet.
 * An older server without the solo endpoint answers 404: records simply stay on this device and the
 * page says so ("unsupported"), nothing is lost and nothing else is affected.
 */
export type SoloSync = "guest" | "offline" | "synced" | "unsupported" | "error";
const KEY = "yachtlab.solo-synced.v1";
const accountOf = soloOwner;
function synced(account: string): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as { account: string; ids: string[] } | null;
    return new Set(raw?.account === account ? raw.ids : []);
  } catch {
    return new Set();
  }
}
function markSynced(account: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ account, ids: [...ids].slice(-2000) }));
  } catch {
    /* ignore */
  }
}
let running: Promise<SoloSync> | null = null;
export function syncSoloRecords(server: string | null): Promise<SoloSync> {
  const account = accountOf();
  if (!account) return Promise.resolve("guest");
  if (!server) return Promise.resolve("offline");
  running ??= (async (): Promise<SoloSync> => {
    try {
      const done = synced(account);
      const pending = soloRecords(account).filter((r) => !done.has(r.recordId));
      for (let i = 0; i < pending.length; i += 150) {
        const chunk = pending.slice(i, i + 150).map(({ replayId: _local, owner: _owner, ...r }) => r);
        await api(server, "/api/me/solo", { body: { records: chunk } });
        chunk.forEach((r) => done.add(r.recordId));
        markSynced(account, done);
      }
      const remote = await api<{ records: SoloRecord[] }>(server, "/api/me/solo");
      remote.records.forEach((r) => done.add(r.recordId));
      markSynced(account, done);
      mergeSoloRecords(remote.records, account);
      return "synced";
    } catch (e) {
      return e instanceof AccountError && e.status === 404 ? "unsupported" : "error";
    } finally {
      running = null;
    }
  })();
  return running;
}
export const soloSyncText: Record<SoloSync, string> = {
  guest: "이 기기에만 저장돼요. 로그인하면 계정에도 보관할 수 있어요.",
  offline: "온라인 서버가 없어 이 기기에만 저장돼요.",
  synced: "계정에 보관돼요(기기에서 기록한 개인 기록).",
  unsupported: "이 기기에 저장했어요. 계정 보관은 서버 업데이트 후 자동으로 이어져요.",
  error: "계정에 보관하지 못했어요. 기록은 이 기기에 있어요.",
};
