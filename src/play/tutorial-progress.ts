const VISIT = "yachtlab.visited.v1";
const AUTO = "yachtlab.tutorial-auto.v1";
const OUTCOME = "yachtlab.tutorial-outcome.v1";

export function registerVisit() {
  try {
    if (localStorage.getItem(VISIT)) return;
    // Installations from before the visit marker already have saved settings, profile or game data.
    const returning = Object.keys(localStorage).some((key) => key.startsWith("yachtlab."));
    localStorage.setItem(VISIT, returning ? "1" : "new");
  } catch {}
}

export function beginFirstGameTutorial() {
  try {
    if (localStorage.getItem(VISIT) !== "new" || localStorage.getItem(AUTO) || localStorage.getItem(OUTCOME)) return false;
    localStorage.setItem(AUTO, "started");
    return true;
  } catch {
    return false;
  }
}

export function finishTutorial(outcome: "completed" | "skipped") {
  try {
    if (localStorage.getItem(OUTCOME) !== "completed") localStorage.setItem(OUTCOME, outcome);
  } catch {}
}
