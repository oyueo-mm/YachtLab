/**
 * SEC-1 / SOC-1: request bodies are size-checked BEFORE they are read. A declared Content-Length above
 * the limit is refused without reading; a body without one (chunked) is read through a byte counter and
 * abandoned as soon as it passes the limit, so a client can never make the Worker buffer a large body.
 * Errors are `Error("too large")` / `SyntaxError`, which the Worker answers with 400 INVALID_COMMAND.
 */
export const BODY_LIMITS = {
  /** Room create / join (name, seats, settings). */
  room: 1024,
  /** Friend, invite, presence, settings and pins routes. */
  social: 4096,
} as const;

export async function readLimitedText(request: Request, max: number): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (!Number.isFinite(n) || n < 0 || n > max) throw new Error("too large");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      throw new Error("too large");
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(all);
}

/** A JSON object body within `max` bytes ({} when empty). */
export async function readJsonObject(request: Request, max: number): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await readLimitedText(request, max);
  } catch (e) {
    if (e instanceof TypeError) throw new SyntaxError("bad encoding");
    throw e;
  }
  const v = JSON.parse(text || "{}");
  if (typeof v !== "object" || v === null || Array.isArray(v)) throw new SyntaxError("object expected");
  return v as Record<string, unknown>;
}
