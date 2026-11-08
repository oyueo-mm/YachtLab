import { validateMultiReplay, type MultiReplay } from "./multi-replay";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("YachtLabMultiReplays", 1);
    request.onupgradeneeded = () => { request.result.createObjectStore("replays", { keyPath: "metadata.id" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(Error("다인전 기보 저장소를 열 수 없습니다."));
    request.onblocked = () => reject(Error("다른 탭의 기보 저장소를 닫고 다시 시도해주세요."));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("replays", mode);
      const req = run(tx.objectStore("replays"));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(Error("기보 저장소 오류입니다. JSON 내보내기로 보존할 수 있습니다."));
      tx.onabort = tx.onerror;
    });
  } finally { db.close(); }
}
export async function saveMultiReplay(replay: MultiReplay) {
  await transaction("readwrite", (store) => store.put(validateMultiReplay(replay)));
}
export async function listMultiReplays() {
  const records = await transaction("readonly", (store) => store.getAll());
  return (records as MultiReplay[]).map(validateMultiReplay).sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
}
export async function deleteMultiReplay(id: string) {
  await transaction("readwrite", (store) => store.delete(id));
}
export async function renameMultiReplay(replay: MultiReplay, title: string) {
  if (!title.trim()) throw Error("기보 이름을 입력해주세요.");
  await saveMultiReplay({ ...replay, metadata: { ...replay.metadata, name: title.trim().slice(0, 80) } });
}
