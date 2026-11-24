/**
 * Display-name policy (Phase 4), shared by the browser and the server. The name is only a label:
 * players are identified by ids (seat playerId, guestId, userId), never by name, so two people may
 * use the same nickname. The server always validates again; the client check is for instant feedback.
 *
 * Rules (docs/online/SOCIAL-AND-ACCOUNTS.md §닉네임):
 *  - Unicode NFC, outer spaces trimmed, inner whitespace runs collapsed to one space.
 *  - 1–12 user-perceived characters (grapheme clusters: 한글 음절, an emoji with skin tone/ZWJ = 1).
 *  - At most 48 UTF-8 bytes (bounds storage / message size for long emoji sequences).
 *  - No control, format (zero-width, bidi override), private-use or surrogate code points, no
 *    line/paragraph separators, no `< > " \` `` (React escapes text anyway; this keeps names inert
 *    everywhere they may be copied), at most 3 combining marks per character (no "zalgo").
 *  - Names that look like staff/official accounts are refused; a small list of slurs is refused.
 * Future (not implemented): colours/effects/titles are separate profile fields, never part of the name.
 */
export const NICKNAME_MAX_GRAPHEMES = 12;
export const NICKNAME_MAX_BYTES = 48;

export type NicknameResult = { ok: true; name: string } | { ok: false; code: "EMPTY" | "TOO_LONG" | "INVALID_CHAR" | "RESERVED" | "BLOCKED"; message: string };

const FORBIDDEN = /[\p{Cc}\p{Co}\p{Cs}\p{Zl}\p{Zp}<>"`\\]|(?!\u200d)\p{Cf}/u;
/** A zero-width joiner is allowed only inside an emoji sequence (👨‍👩‍👧), never as a hidden separator. */
const LONE_ZWJ = /(?<!\p{Extended_Pictographic}\p{M}*)\u200d|\u200d(?!\p{Extended_Pictographic})/u;
const MARKS = /\p{M}/gu;

export function graphemes(text: string): string[] {
  const Seg = (Intl as unknown as { Segmenter?: new (l?: string, o?: { granularity: "grapheme" }) => { segment(s: string): Iterable<{ segment: string }> } }).Segmenter;
  if (Seg) return [...new Seg(undefined, { granularity: "grapheme" }).segment(text)].map((s) => s.segment);
  return Array.from(text);
}

/** Lower-cased, width-folded, with spaces, punctuation and symbols removed: what a name "reads as". */
function skeleton(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}_]/gu, "")
    .replace(/0/g, "o")
    .replace(/1/g, "i");
}

/** Staff / official look-alikes (substring match on the skeleton). */
const RESERVED = ["운영자", "운영진", "운영팀", "관리자", "관리팀", "admin", "administrator", "moderator", "yachtlab", "요트랩", "공식", "official", "staff", "스태프", "개발자", "developer", "system", "시스템", "고객센터", "support"];
/** Exact skeleton matches only (too short for substring matching). */
const RESERVED_EXACT = ["gm", "mod", "운영", "관리", "dev", "root"];
/**
 * A deliberately small list of slurs / sexual terms (substring on the skeleton). Not a complete
 * filter: there is no free-text chat, names are short, and reporting/moderation is a later step.
 */
const BLOCKED = ["시발", "씨발", "ㅅㅂ", "병신", "ㅂㅅ", "좆", "섹스", "fuck", "shit", "bitch", "nigger", "faggot"];

const RESERVED_SK = RESERVED.map(skeleton);
const RESERVED_EXACT_SK = RESERVED_EXACT.map(skeleton);
const BLOCKED_SK = BLOCKED.map(skeleton);

export function validateNickname(raw: unknown): NicknameResult {
  if (typeof raw !== "string") return { ok: false, code: "EMPTY", message: "닉네임을 입력해 주세요." };
  if (raw.length > 400) return { ok: false, code: "TOO_LONG", message: `닉네임은 ${NICKNAME_MAX_GRAPHEMES}자까지 쓸 수 있어요.` };
  const name = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (!name) return { ok: false, code: "EMPTY", message: "닉네임을 입력해 주세요." };
  if (FORBIDDEN.test(name) || LONE_ZWJ.test(name)) return { ok: false, code: "INVALID_CHAR", message: "닉네임에 쓸 수 없는 문자가 있어요." };
  const chars = graphemes(name);
  if (chars.length > NICKNAME_MAX_GRAPHEMES || new TextEncoder().encode(name).length > NICKNAME_MAX_BYTES)
    return { ok: false, code: "TOO_LONG", message: `닉네임은 ${NICKNAME_MAX_GRAPHEMES}자까지 쓸 수 있어요.` };
  if (chars.some((c) => (c.match(MARKS)?.length ?? 0) > 3)) return { ok: false, code: "INVALID_CHAR", message: "닉네임에 쓸 수 없는 문자가 있어요." };
  const sk = skeleton(name);
  if (RESERVED_SK.some((r) => sk.includes(r)) || RESERVED_EXACT_SK.includes(sk)) return { ok: false, code: "RESERVED", message: "운영자·관리자로 보일 수 있는 닉네임은 쓸 수 없어요." };
  if (BLOCKED_SK.some((b) => sk.includes(b))) return { ok: false, code: "BLOCKED", message: "사용할 수 없는 닉네임이에요." };
  return { ok: true, name };
}
