import { cleanText } from "../admin/store";

/**
 * FEEDBACK-1 — the service suggestion board, the logic of the one global `SuggestionBoard` Durable
 * Object (runtime-free; node:sqlite in tests).
 *
 * Safety rules (docs/admin/ADMIN-FEEDBACK.md §4):
 *  - plain text only: control / bidi characters removed, length capped; the page renders text nodes
 *    (never HTML), and links are shown as text, never as clickable anchors; at most 3 links per post;
 *  - rate limits per account: 1 post per 2 minutes, 5 per day, no repeated title within 24 h;
 *  - security / privacy reports are PRIVATE (author and admins only), never listed publicly;
 *  - 5 distinct reports hide a post until an admin reviews it;
 *  - writing a suggestion earns nothing. Only an admin adoption may lead to a reward, which goes
 *    through the admin approval and the account's economy ledger (the board never touches coins);
 *  - account deletion: the author link and the author's votes are removed; the post stays as
 *    "탈퇴한 사용자" (public) — private reports are deleted with the account.
 * Attachments are OFF (no storage chosen yet): `checkAttachment` exists for the future upload path.
 */
export interface BoardSql {
  exec<T = Record<string, unknown>>(query: string, ...params: unknown[]): { toArray(): T[] };
  transaction?<T>(fn: () => T): T;
}
export const CATEGORIES = ["feature", "uiux", "item", "mode", "bug", "security", "privacy"] as const;
/** Security reports and privacy / personal inquiries are never public (SEC-1). */
export const PRIVATE_CATEGORIES: readonly Category[] = ["security", "privacy"];
export type Category = (typeof CATEGORIES)[number];
export const STATUSES = ["received", "reviewing", "adopted", "in_progress", "done", "on_hold", "declined"] as const;
export type Status = (typeof STATUSES)[number];
export const BOARD_LIMITS = { titleMin: 4, titleMax: 80, bodyMin: 10, bodyMax: 4000, perDay: 5, gapMs: 2 * 60_000, maxLinks: 3, hideAtReports: 5, page: 20, votesPerDay: 100 } as const;
export const ATTACHMENTS_ENABLED = false;

type Fail = { ok: false; code: string; message: string };
const fail = (code: string, message: string): Fail => ({ ok: false, code, message });
const USER = /^u_[A-Za-z0-9_-]{22}$/;
const ID = /^sg_[a-z0-9]{16}$/;
const LINK = /\b(?:https?:\/\/|www\.)\S+/gi;
const BAD_SCHEME = /\b(?:javascript|data|vbscript|file):/i;

export type SuggestionView = {
  id: string;
  category: Category;
  title: string;
  body?: string;
  status: Status;
  votes: number;
  voted?: boolean;
  mine?: boolean;
  author: string;
  private: boolean;
  createdAt: number;
  updatedAt: number;
  answer: string | null;
  answeredAt: number | null;
  credit?: boolean;
  hidden?: boolean;
  reports?: number;
};

type Row = { id: string; author_id: string | null; author_name: string; category: Category; title: string; body: string; status: Status; votes: number; private: number; hidden: number; reports: number; answer: string | null; answered_at: number | null; adopt_reason: string | null; credit: number; reward_action: string | null; created_at: number; updated_at: number };

/** Validate a future image attachment (type by magic bytes, size). Upload stays disabled. */
export function checkAttachment(bytes: Uint8Array, declaredType: string): { ok: true; type: string } | Fail {
  if (bytes.length === 0 || bytes.length > 1_000_000) return fail("SIZE", "이미지는 1MB 이하만 첨부할 수 있어요.");
  const sig = (xs: number[], at = 0) => xs.every((x, i) => bytes[at + i] === x);
  const type = sig([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? "image/png" : sig([0xff, 0xd8, 0xff]) ? "image/jpeg" : sig([0x52, 0x49, 0x46, 0x46]) && sig([0x57, 0x45, 0x42, 0x50], 8) ? "image/webp" : null;
  if (!type || type !== declaredType) return fail("TYPE", "PNG·JPEG·WebP 이미지만 첨부할 수 있어요.");
  return { ok: true, type };
}

export class BoardCore {
  constructor(private readonly sql: BoardSql) {}
  private tx<T>(fn: () => T): T {
    return this.sql.transaction ? this.sql.transaction(fn) : fn();
  }
  private one<T>(q: string, ...p: unknown[]) {
    return this.sql.exec<T>(q, ...p).toArray()[0];
  }
  init() {
    this.sql.exec("CREATE TABLE IF NOT EXISTS suggestions (id TEXT PRIMARY KEY, author_id TEXT, author_name TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, votes INTEGER NOT NULL DEFAULT 0, private INTEGER NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0, answer TEXT, answered_at INTEGER, adopt_reason TEXT, credit INTEGER NOT NULL DEFAULT 0, reward_action TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sg_created ON suggestions (created_at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sg_by_votes ON suggestions (votes, created_at)");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sg_author ON suggestions (author_id, created_at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sg_votes (suggestion_id TEXT NOT NULL, user_id TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (suggestion_id, user_id))");
    this.sql.exec("CREATE INDEX IF NOT EXISTS sg_votes_user ON sg_votes (user_id, at)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sg_reports (suggestion_id TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (suggestion_id, user_id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS sg_history (seq INTEGER PRIMARY KEY AUTOINCREMENT, suggestion_id TEXT NOT NULL, at INTEGER NOT NULL, by TEXT NOT NULL, change TEXT NOT NULL)");
  }

  private view(r: Row, viewer: string | null, admin = false): SuggestionView {
    const mine = !!viewer && r.author_id === viewer;
    return {
      id: r.id, category: r.category, title: r.title, body: r.body, status: r.status, votes: r.votes, mine,
      voted: viewer ? !!this.one("SELECT 1 FROM sg_votes WHERE suggestion_id = ? AND user_id = ?", r.id, viewer) : false,
      author: r.author_name, private: !!r.private, createdAt: r.created_at, updatedAt: r.updated_at, answer: r.answer, answeredAt: r.answered_at,
      ...(mine || admin ? { credit: !!r.credit } : {}),
      ...(admin ? { hidden: !!r.hidden, reports: r.reports } : {}),
    };
  }

  create(author: { userId: string; nickname: string | null }, raw: unknown, now: number): { ok: true; id: string } | Fail {
    if (!USER.test(author.userId)) return fail("UNAUTHENTICATED", "로그인이 필요해요.");
    if (!author.nickname) return fail("NICKNAME", "닉네임을 먼저 정해 주세요.");
    const r = (raw ?? {}) as Record<string, unknown>;
    const category = CATEGORIES.find((c) => c === r.category);
    if (!category) return fail("INVALID", "분류를 골라 주세요.");
    const title = cleanText(r.title, BOARD_LIMITS.titleMax).replace(/\s+/g, " ");
    const body = cleanText(r.body, BOARD_LIMITS.bodyMax);
    if (title.length < BOARD_LIMITS.titleMin) return fail("INVALID", `제목을 ${BOARD_LIMITS.titleMin}자 이상 적어 주세요.`);
    if (body.length < BOARD_LIMITS.bodyMin) return fail("INVALID", `내용을 ${BOARD_LIMITS.bodyMin}자 이상 적어 주세요.`);
    if (BAD_SCHEME.test(title + " " + body)) return fail("LINK", "허용되지 않는 링크 형식이 있어요.");
    if ((body.match(LINK)?.length ?? 0) + (title.match(LINK)?.length ?? 0) > BOARD_LIMITS.maxLinks) return fail("LINK", `링크는 ${BOARD_LIMITS.maxLinks}개까지만 적을 수 있어요.`);
    if (r.attachments !== undefined && !ATTACHMENTS_ENABLED) return fail("ATTACHMENTS_OFF", "스크린샷 첨부는 아직 준비 중이에요.");
    const last = this.one<{ at: number | null; n: number }>("SELECT max(created_at) AS at, count(*) AS n FROM suggestions WHERE author_id = ? AND created_at > ?", author.userId, now - 86_400_000);
    if (last && last.at !== null && now - last.at < BOARD_LIMITS.gapMs) return fail("RATE_LIMITED", "잠시 후 다시 작성해 주세요.");
    if ((last?.n ?? 0) >= BOARD_LIMITS.perDay) return fail("RATE_LIMITED", `제안은 하루 ${BOARD_LIMITS.perDay}개까지 작성할 수 있어요.`);
    if (this.one("SELECT 1 FROM suggestions WHERE author_id = ? AND title = ? AND created_at > ?", author.userId, title, now - 86_400_000)) return fail("DUPLICATE", "같은 제목의 제안을 이미 작성했어요.");
    const id = "sg_" + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    this.sql.exec("INSERT INTO suggestions (id, author_id, author_name, category, title, body, status, private, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'received', ?, ?, ?)",
      id, author.userId, author.nickname, category, title, body, PRIVATE_CATEGORIES.includes(category) ? 1 : 0, now, now);
    return { ok: true, id };
  }

  list(q: { viewer: string | null; q?: string; category?: string; status?: string; sort?: string; mine?: boolean; page?: number; admin?: boolean }) {
    const page = Math.max(0, Math.floor(Number(q.page ?? 0)) || 0);
    const text = cleanText(q.q ?? "", 40);
    const like = text ? "%" + text.replace(/[%_\\]/g, (c) => "\\" + c) + "%" : "";
    const category = CATEGORIES.find((c) => c === q.category) ?? "";
    const status = STATUSES.find((s) => s === q.status) ?? "";
    const viewer = q.viewer ?? "";
    if (q.mine && !viewer) return { total: 0, page, pageSize: BOARD_LIMITS.page, items: [] as SuggestionView[] };
    const visibility = q.admin ? "1 = 1" : "((private = 0 AND hidden = 0) OR author_id = ?)";
    const where = `${visibility} AND (? = '' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\') AND (? = '' OR category = ?) AND (? = '' OR status = ?) AND (? = 0 OR author_id = ?)`;
    const args = [...(q.admin ? [] : [viewer]), like, like, like, category, category, status, status, q.mine ? 1 : 0, viewer];
    const order = q.sort === "top" ? "votes DESC, created_at DESC" : "created_at DESC";
    const total = this.one<{ n: number }>(`SELECT count(*) AS n FROM suggestions WHERE ${where}`, ...args)?.n ?? 0;
    const rows = this.sql.exec<Row>(`SELECT * FROM suggestions WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...args, BOARD_LIMITS.page, page * BOARD_LIMITS.page).toArray();
    return { total, page, pageSize: BOARD_LIMITS.page, items: rows.map((r) => {
      const v = this.view(r, q.viewer, q.admin);
      return { ...v, body: (v.body ?? "").slice(0, 160) };
    }) };
  }

  get(id: string, viewer: string | null, admin = false): SuggestionView | null {
    if (!ID.test(id)) return null;
    const r = this.one<Row>("SELECT * FROM suggestions WHERE id = ?", id);
    if (!r) return null;
    if (!admin && (r.private || r.hidden) && r.author_id !== viewer) return null;
    return this.view(r, viewer, admin);
  }

  vote(id: string, userId: string, on: boolean, now: number): { ok: true; votes: number; voted: boolean } | Fail {
    if (!USER.test(userId)) return fail("UNAUTHENTICATED", "로그인이 필요해요.");
    return this.tx(() => {
      const r = this.one<{ author_id: string | null; private: number; hidden: number; votes: number }>("SELECT author_id, private, hidden, votes FROM suggestions WHERE id = ?", id);
      if (!r || r.private || r.hidden) return fail("NOT_FOUND", "제안을 찾을 수 없어요.");
      if (r.author_id === userId) return fail("OWN", "자신의 제안에는 추천할 수 없어요.");
      const had = !!this.one("SELECT 1 FROM sg_votes WHERE suggestion_id = ? AND user_id = ?", id, userId);
      if (on && !had) {
        const today = this.one<{ n: number }>("SELECT count(*) AS n FROM sg_votes WHERE user_id = ? AND at > ?", userId, now - 86_400_000)?.n ?? 0;
        if (today >= BOARD_LIMITS.votesPerDay) return fail("RATE_LIMITED", "오늘은 더 추천할 수 없어요.");
        this.sql.exec("INSERT INTO sg_votes (suggestion_id, user_id, at) VALUES (?, ?, ?)", id, userId, now);
        this.sql.exec("UPDATE suggestions SET votes = votes + 1 WHERE id = ?", id);
      } else if (!on && had) {
        this.sql.exec("DELETE FROM sg_votes WHERE suggestion_id = ? AND user_id = ?", id, userId);
        this.sql.exec("UPDATE suggestions SET votes = max(0, votes - 1) WHERE id = ?", id);
      }
      return { ok: true as const, votes: this.one<{ votes: number }>("SELECT votes FROM suggestions WHERE id = ?", id)!.votes, voted: on };
    });
  }

  report(id: string, userId: string, reason: unknown, now: number): { ok: true; hidden: boolean } | Fail {
    return this.tx(() => {
      const r = this.one<{ author_id: string | null; private: number }>("SELECT author_id, private FROM suggestions WHERE id = ?", id);
      if (!r || r.private) return fail("NOT_FOUND", "제안을 찾을 수 없어요.");
      if (r.author_id === userId) return fail("OWN", "자신의 글은 신고할 수 없어요.");
      if (this.one("SELECT 1 FROM sg_reports WHERE suggestion_id = ? AND user_id = ?", id, userId)) return fail("DUPLICATE", "이미 신고했어요.");
      this.sql.exec("INSERT INTO sg_reports (suggestion_id, user_id, reason, at) VALUES (?, ?, ?, ?)", id, userId, cleanText(reason, 300) || "inappropriate", now);
      this.sql.exec("UPDATE suggestions SET reports = reports + 1, hidden = CASE WHEN reports + 1 >= ? THEN 1 ELSE hidden END WHERE id = ?", BOARD_LIMITS.hideAtReports, id);
      return { ok: true as const, hidden: !!this.one<{ hidden: number }>("SELECT hidden FROM suggestions WHERE id = ?", id)?.hidden };
    });
  }

  setCredit(id: string, userId: string, credit: boolean, now: number): { ok: true } | Fail {
    const r = this.one<{ author_id: string | null }>("SELECT author_id FROM suggestions WHERE id = ?", id);
    if (!r || r.author_id !== userId) return fail("NOT_FOUND", "제안을 찾을 수 없어요.");
    this.sql.exec("UPDATE suggestions SET credit = ?, updated_at = ? WHERE id = ?", credit ? 1 : 0, now, id);
    return { ok: true };
  }

  /** Adopted suggestions whose authors agreed to be credited (update notes). */
  contributors() {
    return this.sql.exec<{ id: string; title: string; author_name: string; answered_at: number | null }>(
      "SELECT id, title, author_name, answered_at FROM suggestions WHERE credit = 1 AND author_id IS NOT NULL AND private = 0 AND status IN ('adopted', 'in_progress', 'done') ORDER BY answered_at DESC LIMIT 100",
    ).toArray().map((r) => ({ id: r.id, title: r.title, nickname: r.author_name, at: r.answered_at }));
  }

  /* ----------------------------------------------------------------- admin ----------------------------------------------------------------- */

  moderate(id: string, by: string, raw: unknown, now: number): { ok: true; suggestion: SuggestionView } | Fail {
    const r = (raw ?? {}) as Record<string, unknown>;
    const row = this.one<Row>("SELECT * FROM suggestions WHERE id = ?", id);
    if (!row) return fail("NOT_FOUND", "제안을 찾을 수 없어요.");
    const status = r.status === undefined ? row.status : STATUSES.find((s) => s === r.status);
    if (!status) return fail("INVALID", "상태가 올바르지 않아요.");
    const answer = r.answer === undefined ? row.answer : cleanText(r.answer, 2000) || null;
    const hidden = r.hidden === undefined ? row.hidden : r.hidden ? 1 : 0;
    const adoptReason = status === "adopted" ? cleanText(r.adoptReason ?? row.adopt_reason ?? "", 500) : row.adopt_reason;
    if (status === "adopted" && row.status !== "adopted" && (adoptReason ?? "").length < 4) return fail("INVALID", "채택 사유를 4자 이상 기록해 주세요.");
    this.tx(() => {
      this.sql.exec("UPDATE suggestions SET status = ?, answer = ?, answered_at = ?, hidden = ?, adopt_reason = ?, updated_at = ? WHERE id = ?",
        status, answer, answer !== row.answer ? now : row.answered_at, hidden, adoptReason, now, id);
      this.sql.exec("INSERT INTO sg_history (suggestion_id, at, by, change) VALUES (?, ?, ?, ?)", id, now, by, JSON.stringify({ status, answered: answer !== row.answer, hidden: !!hidden, adoptReason: status === "adopted" ? adoptReason : undefined }));
    });
    return { ok: true, suggestion: this.get(id, null, true)! };
  }
  /** For the adoption reward: author and whether a reward was already requested (one per suggestion). */
  rewardTarget(id: string): { ok: true; userId: string; title: string } | Fail {
    const r = this.one<Row>("SELECT * FROM suggestions WHERE id = ?", id);
    if (!r) return fail("NOT_FOUND", "제안을 찾을 수 없어요.");
    if (!["adopted", "in_progress", "done"].includes(r.status)) return fail("STATE", "채택된 제안에만 감사 보상을 줄 수 있어요.");
    if (!r.author_id) return fail("NO_AUTHOR", "작성자가 탈퇴해 보상을 줄 수 없어요.");
    if (r.reward_action) return fail("DUPLICATE", "이미 보상을 요청한 제안이에요.");
    return { ok: true, userId: r.author_id, title: r.title };
  }
  markReward(id: string, actionId: string) {
    this.sql.exec("UPDATE suggestions SET reward_action = ? WHERE id = ? AND reward_action IS NULL", actionId, id);
  }
  history(id: string) {
    return this.sql.exec<{ at: number; by: string; change: string }>("SELECT at, by, change FROM sg_history WHERE suggestion_id = ? ORDER BY seq", id).toArray().map((h) => ({ ...h, change: JSON.parse(h.change) as unknown }));
  }

  /** Account deletion: public posts stay anonymous, private reports go, votes and reports by the account go. */
  forget(userId: string) {
    this.tx(() => {
      for (const v of this.sql.exec<{ suggestion_id: string }>("SELECT suggestion_id FROM sg_votes WHERE user_id = ?", userId).toArray()) this.sql.exec("UPDATE suggestions SET votes = max(0, votes - 1) WHERE id = ?", v.suggestion_id);
      this.sql.exec("DELETE FROM sg_votes WHERE user_id = ?", userId);
      this.sql.exec("DELETE FROM sg_reports WHERE user_id = ?", userId);
      this.sql.exec("DELETE FROM sg_votes WHERE suggestion_id IN (SELECT id FROM suggestions WHERE author_id = ? AND private = 1)", userId);
      this.sql.exec("DELETE FROM suggestions WHERE author_id = ? AND private = 1", userId);
      this.sql.exec("UPDATE suggestions SET author_id = NULL, author_name = '탈퇴한 사용자', credit = 0 WHERE author_id = ?", userId);
    });
  }
  stats() {
    const by = (col: string) => Object.fromEntries(this.sql.exec<{ k: string; n: number }>(`SELECT ${col} AS k, count(*) AS n FROM suggestions GROUP BY ${col}`).toArray().map((r) => [r.k, r.n]));
    return { byStatus: by("status"), byCategory: by("category"), hidden: this.one<{ n: number }>("SELECT count(*) AS n FROM suggestions WHERE hidden = 1")?.n ?? 0 };
  }
}
