import { validateReplay, type Replay } from "./replay";
function database() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("YachtLabReplays", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("replays", { keyPath: "metadata.id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(Error("브라우저 기보 저장소를 열 수 없습니다."));
    request.onblocked = () =>
      reject(Error("다른 탭의 기보 저장소를 닫고 다시 시도해주세요."));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("replays", mode),
        request = run(tx.objectStore("replays"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () =>
        reject(
          Error(
            "기보 저장 공간 또는 저장소 오류입니다. JSON 내보내기로 보존할 수 있습니다.",
          ),
        );
      tx.onabort = tx.onerror;
    });
  } finally {
    db.close();
  }
}
export const saveReplay = async (r: Replay) => {
  await transaction("readwrite", (s) => s.put(validateReplay(r)));
};
export const listReplays = async () => {
  const rows = await transaction("readonly", (s) => s.getAll());
  return (rows as Replay[])
    .map(validateReplay)
    .sort((a, b) => b.metadata.createdAt.localeCompare(a.metadata.createdAt));
};
export const deleteReplay = async (id: string) => {
  await transaction("readwrite", (s) => s.delete(id));
};
export const renameReplay = async (r: Replay, name: string) => {
  if (!name.trim()) throw Error("이름을 입력해주세요.");
  await saveReplay({
    ...r,
    metadata: { ...r.metadata, name: name.trim().slice(0, 80) },
  });
};
