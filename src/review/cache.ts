import type { ReviewMatch, ReviewResults } from "./model";
import { reviewAlgorithmVersion, reviewModel } from "./model";
import { decisionLoss } from "./quality";

type Summary = {
  key: string;
  at: number;
  players: [string, string];
  meanLoss: [number | null, number | null];
  model: string;
};

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("YachtLabReview", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("analysis");
      req.result.createObjectStore("summary", { keyPath: "key" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error("리뷰 저장소가 다른 탭에서 열려 있어요."));
  });
}

async function read<T>(store: "analysis" | "summary", operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store);
      const req = operation(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

export async function reviewKey(match: ReviewMatch, serialized: string, version: string = reviewModel.version) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(serialized)));
  return JSON.stringify([reviewAlgorithmVersion, version, match.id, Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("")]);
}
export const cachedReview = (key: string) => read<ReviewResults | undefined>("analysis", (store) => store.get(key));
export const reviewSummaries = () => read<Summary[]>("summary", (store) => store.getAll());

export async function saveAnalysis(key: string, match: ReviewMatch, values: ReviewResults, version: string = reviewModel.version) {
  const averages = ([0, 1] as const).map((seat) => {
    const losses = values.values.flatMap((item) => {
      const step = match.steps[item.index];
      const loss = decisionLoss(item, match.solo ? "score" : "win");
      return step.before.player === seat && !step.automatic && loss !== undefined ? [loss] : [];
    });
    return losses.length ? losses.reduce((sum, loss) => sum + loss, 0) / losses.length : null;
  }) as Summary["meanLoss"];
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["analysis", "summary"], "readwrite");
      const analysis = tx.objectStore("analysis");
      const summary = tx.objectStore("summary");
      analysis.put(values, key);
      summary.put({ key, at: Date.now(), meanLoss: averages, players: match.players, model: version + ":" + reviewAlgorithmVersion } satisfies Summary);
      const rows = summary.getAll() as IDBRequest<Summary[]>;
      rows.onsuccess = () => {
        for (const item of rows.result.sort((a, b) => b.at - a.at).slice(16)) {
          summary.delete(item.key);
          analysis.delete(item.key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
