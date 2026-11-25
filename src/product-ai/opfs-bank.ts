import { BANK_FLOATS, type WasmBank } from "../research-v6/wasm-pmf";

const dataBytes = BANK_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const indexBytes = 4096 * 64 * 2 * Int32Array.BYTES_PER_ELEMENT;
const chunkBytes = 1024 * 1024;
const digestBytes = 32;
const fileBytes = dataBytes + indexBytes + (Math.ceil(dataBytes / chunkBytes) + Math.ceil(indexBytes / chunkBytes)) * digestBytes;
const bytesOf = (view: Float32Array | Int32Array) => new Uint8Array(view.buffer as ArrayBuffer, view.byteOffset, view.byteLength);

async function run(
  handle: FileSystemSyncAccessHandle, data: Uint8Array<ArrayBuffer>, index: Uint8Array<ArrayBuffer>, mode: "read" | "write",
) {
  if (mode === "read" && handle.getSize() !== fileBytes) throw Error("Incomplete PMF cache");
  if (mode === "write") handle.truncate(0);
  let checksumOffset = dataBytes + indexBytes;
  for (const [array, base] of [[data, 0], [index, dataBytes]] as const) {
    for (let offset = 0; offset < array.length; offset += chunkBytes) {
      const chunk = array.subarray(offset, offset + chunkBytes);
      const io = mode === "read" ? handle.read.bind(handle) : handle.write.bind(handle);
      if (io(chunk, { at: base + offset }) !== chunk.length) throw Error("Incomplete PMF cache chunk");
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", chunk));
      const actual = mode === "read" ? new Uint8Array(digestBytes) : hash;
      if (io(actual, { at: checksumOffset }) !== digestBytes || !hash.every((value, i) => value === actual[i])) {
        throw Error("Invalid PMF cache checksum");
      }
      checksumOffset += digestBytes;
    }
  }
  if (mode === "write") handle.flush();
}

async function file(key: string, create: boolean) {
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle("yachtlab-product-ai", { create });
  return (await dir.getFileHandle(key, { create })).createSyncAccessHandle();
}

export async function readBank(key: string): Promise<WasmBank | undefined> {
  let handle: FileSystemSyncAccessHandle | undefined;
  try {
    handle = await file(key, false);
    if (handle.getSize() !== fileBytes) return;
    const start = performance.now();
    const data = new Float32Array(BANK_FLOATS);
    const index = new Int32Array(indexBytes / Int32Array.BYTES_PER_ELEMENT);
    await run(handle, bytesOf(data), bytesOf(index), "read");
    return { data, index, floats: BANK_FLOATS, buildMs: performance.now() - start, memoryBytes: dataBytes + indexBytes };
  } catch {
    return undefined;
  } finally {
    handle?.close();
  }
}

export async function writeBank(key: string, bank: WasmBank) {
  let handle: FileSystemSyncAccessHandle | undefined;
  try {
    if (!(bank.data instanceof Float32Array) || bank.floats !== BANK_FLOATS) return;
    handle = await file(key, true);
    await run(handle, bytesOf(bank.data), bytesOf(bank.index), "write");
  } catch {
    // A private or full storage area is optional. A partial file fails length or hash validation.
  } finally {
    handle?.close();
  }
}
