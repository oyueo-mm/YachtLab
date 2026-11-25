const VISIT = "yachtlab.visited.v1";
const AUTO = "yachtlab.tutorial-auto.v1";
const OUTCOME = "yachtlab.tutorial-outcome.v1";

export function firstTutorialVisit() {
  try {
    if (localStorage.getItem(VISIT) || localStorage.getItem(AUTO) || localStorage.getItem(OUTCOME)) return false;
    // Installations from before the visit marker already have saved settings, profile or game data.
    return !Object.keys(localStorage).some((key) => key.startsWith("yachtlab."));
  } catch {
    // Avoid forcing a tutorial on each reload if the browser blocks persistence.
    return false;
  }
}

export function registerVisit(automatic: boolean) {
  try {
    if (automatic) localStorage.setItem(AUTO, "started");
    localStorage.setItem(VISIT, "1");
  } catch {}
}

export function tutorialSeen() {
  try {
    return !!(localStorage.getItem(OUTCOME) || localStorage.getItem("yachtlab.tutorial.v1"));
  } catch {
    return false;
  }
}

export function finishTutorial(outcome: "completed" | "skipped") {
  try {
    if (localStorage.getItem(OUTCOME) !== "completed") localStorage.setItem(OUTCOME, outcome);
  } catch {}
}
