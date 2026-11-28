import { isDailyDate } from "../../src/daily/calendar";
import { dailyAdminReport, puzzlesOf, type DailyBoardApi } from "./daily-api";

/**
 * LIVE-1 operations routes in the ADMIN-1 `AdminExtensionRoute` shape (docs/admin/LIVE-1-ADMIN-CONTRACT.md,
 * PR #141). The ADMIN-1 router is not on main yet, so this file mirrors the route type structurally and
 * exports `dailyAdminRoutes(deps)`; INT-1 registers it with `extensions: dailyAdminRoutes(deps)` in the
 * `engagement()` admin backend. The router — not these handlers — does the admin session check, the role
 * re-read from ADMIN_ACCOUNTS, the permission check, the ADMIN_WRITES gate and the audit row per write.
 *
 * There is NO shared-token path for daily operations any more (D-LIVE1-5): until INT-1 registers these
 * routes, `/api/admin/daily*` answers 404 like any unknown admin path.
 */
export type DailyAdminPermission = "stats.read" | "content.write";
export type DailyAdminRoute = {
  method: "GET" | "POST";
  path: RegExp;
  permission: DailyAdminPermission;
  write: boolean;
  highRisk?: boolean;
  auditRead?: boolean;
  action: string;
  handle(ctx: { url: URL; match: RegExpExecArray; body: Record<string, unknown> | null; actor: string; now: number }): Promise<{ status: number; body: unknown; target?: string; detail?: unknown }>;
};
export type DailyAdminDeps = { board(date: string): Pick<DailyBoardApi, "stats" | "setPuzzleFlag">; now(): number };

const bad = (message: string) => ({ status: 400, body: { error: { code: "INVALID", message } } });

export function dailyAdminRoutes(deps: DailyAdminDeps): DailyAdminRoute[] {
  return [
    {
      method: "GET",
      path: /^\/api\/admin\/daily$/,
      permission: "stats.read",
      write: false,
      action: "daily.report",
      // aggregates only (no account id or nickname), so the read is not audited
      async handle({ url }) {
        const date = url.searchParams.get("date") ?? "";
        if (!isDailyDate(date)) return bad("date=YYYY-MM-DD");
        return { status: 200, body: await dailyAdminReport({ board: deps.board as never, now: deps.now }, date) };
      },
    },
    {
      method: "POST",
      path: /^\/api\/admin\/daily\/puzzle$/,
      permission: "content.write",
      write: true,
      highRisk: false,
      action: "daily.puzzle",
      // withdraw (disabled: true, default) or restore (disabled: false) one scheduled puzzle
      async handle({ body }) {
        const date = body?.date, puzzleId = body?.puzzleId;
        if (!isDailyDate(date) || typeof puzzleId !== "string" || !puzzlesOf(date).some((p) => p.id === puzzleId))
          return bad("date, puzzleId (scheduled on that date), disabled");
        if (body?.disabled !== undefined && typeof body.disabled !== "boolean") return bad("disabled must be true or false");
        const disabled = body?.disabled !== false;
        await deps.board(date).setPuzzleFlag(puzzleId, disabled);
        return { status: 200, body: { date, puzzleId, disabled }, target: puzzleId, detail: { date, disabled } };
      },
    },
  ];
}
