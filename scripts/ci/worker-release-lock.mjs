/**
 * SEC-1-03 (D-102): the automatic Worker release stops after any unsafe release outcome and resumes only after an
 * operator's manual release succeeds. "Succeeds" means the manual workflow's `deploy` job concluded success (the
 * Worker was written and checked), not merely that the run ended green.
 *
 * Lock evidence, among release runs (automatic + manual) created after that manual release:
 *  - conclusion failure, timed_out or startup_failure;
 *  - any re-run (run_attempt > 1): releases are never retried, so a re-run is itself a reason to stop;
 *  - cancelled after the release/deploy job started a step past its setup (a write may have begun).
 *    A run cancelled before that (e.g. replaced while queued) is not evidence.
 * Run history is read completely (every page since the last manual release); more than MAX_PAGES pages, or any
 * read error, stops the release (fail closed).
 */
export const AUTO_WORKFLOW = "deploy-online-worker-auto.yml";
export const MANUAL_WORKFLOW = "deploy-online-worker.yml";
export const PER_PAGE = 100;
export const MAX_PAGES = 10;
const LOCKING = new Set(["failure", "timed_out", "startup_failure"]);
/** The job and the step that write to Cloudflare in each workflow (names must match the workflow files). */
export const RELEASE_JOBS = { [AUTO_WORKFLOW]: "release", [MANUAL_WORKFLOW]: "deploy" };
export const RELEASE_STEPS = { [AUTO_WORKFLOW]: "Plan, release and record the yachtlab-online Worker", [MANUAL_WORKFLOW]: "Release and record the existing yachtlab-online Worker" };

export class LockReadError extends Error {}

/**
 * @param get   async (path) => parsed JSON of https://api.github.com/repos/<repo><path>; throws on HTTP errors
 * @returns { locked: false } | { locked: true, reason, run }
 */
export async function releaseLock(get, currentRunId) {
  const recovery = await lastManualRelease(get);
  const since = recovery ? `&created=${encodeURIComponent(">" + recovery.created_at)}` : "";
  for (const workflow of [AUTO_WORKFLOW, MANUAL_WORKFLOW]) {
    for (const run of await allRuns(get, workflow, since)) {
      if (run.id === currentRunId || (recovery && run.id === recovery.id)) continue;
      const reason = await lockReason(get, workflow, run);
      if (reason) return { locked: true, reason, run };
    }
  }
  return { locked: false, recovery };
}

async function allRuns(get, workflow, filter) {
  const runs = [];
  for (let page = 1; ; page++) {
    if (page > MAX_PAGES) throw new LockReadError(`More than ${MAX_PAGES * PER_PAGE} ${workflow} runs to check since the last manual release.`);
    const body = await get(`/actions/workflows/${workflow}/runs?branch=main&per_page=${PER_PAGE}&page=${page}${filter}`);
    const list = body?.workflow_runs;
    if (!Array.isArray(list)) throw new LockReadError(`Unexpected ${workflow} run list.`);
    runs.push(...list);
    if (list.length < PER_PAGE) return runs;
  }
}

/** The newest manual run whose deploy job succeeded (the operator recovery point). */
async function lastManualRelease(get) {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get(`/actions/workflows/${MANUAL_WORKFLOW}/runs?branch=main&status=success&per_page=${PER_PAGE}&page=${page}`);
    const list = body?.workflow_runs;
    if (!Array.isArray(list)) throw new LockReadError("Unexpected manual run list.");
    for (const run of list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))) {
      if (run.run_attempt !== 1) continue; // a re-run is never a recovery
      const job = (await jobs(get, run.id)).find((j) => j.name === RELEASE_JOBS[MANUAL_WORKFLOW]);
      if (job?.conclusion === "success") return run;
    }
    if (list.length < PER_PAGE) return null;
  }
  throw new LockReadError("Could not find the last manual release within the readable history.");
}

async function jobs(get, runId) {
  const body = await get(`/actions/runs/${runId}/jobs?filter=all&per_page=100`);
  if (!Array.isArray(body?.jobs)) throw new LockReadError("Unexpected job list.");
  return body.jobs;
}

export async function lockReason(get, workflow, run) {
  if (run.run_attempt > 1) return `run ${run.id} was re-run (attempt ${run.run_attempt}); releases are not retried`;
  if (run.status !== "completed") return null; // the concurrency group keeps releases from overlapping
  if (LOCKING.has(run.conclusion)) return `run ${run.id} ended ${run.conclusion}`;
  if (run.conclusion !== "cancelled") return null;
  const job = (await jobs(get, run.id)).find((j) => j.name === RELEASE_JOBS[workflow]);
  const started = (job?.steps ?? []).some((s) => s.name === RELEASE_STEPS[workflow] && s.started_at && s.conclusion !== "skipped");
  return started ? `run ${run.id} was cancelled during its release step` : null;
}
