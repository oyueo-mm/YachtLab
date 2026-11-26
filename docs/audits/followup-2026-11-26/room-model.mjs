// Steady-state capacity estimates for 1:1. No server or account traffic.
const maxRooms = 50;
const dailyUnits = 300;
const matchMinutes = 15;
const peakMinutes = 120;
const pResultTabStays = .25;
const launchHold = 1;
const assumptions = { maxRooms, dailyUnits, randomCutoff: 285, matchMinutes, peakMinutes, pResultTabStays, launchHold };
const scenarios = [];
for (const outcome of [
  { policy: 'current', openMinutes: 60, emptyMinutes: 3, rematchShare: 0 },
  { policy: 'reuse', openMinutes: 60, emptyMinutes: 3, rematchShare: .4 },
  { policy: 'finished-open-10', openMinutes: 10, emptyMinutes: 3, rematchShare: 0 },
  { policy: 'both', openMinutes: 10, emptyMinutes: 3, rematchShare: .4 },
]) {
  const terminalMinutes = pResultTabStays * outcome.openMinutes + (1 - pResultTabStays) * outcome.emptyMinutes;
  const minutesPerMatch = matchMinutes + outcome.rematchShare * launchHold + (1 - outcome.rematchShare) * terminalMinutes;
  const matchesPerMinute = maxRooms / minutesPerMatch;
  scenarios.push({
    ...outcome, terminalMinutes,
    matchesPerTwoHourPeak: Math.floor(matchesPerMinute * peakMinutes),
    peakMatchesAfterDailyBudget: Math.min(dailyUnits, Math.floor(assumptions.randomCutoff / (1 - outcome.rematchShare)), Math.floor(matchesPerMinute * peakMinutes)),
    steadyActivePlayers: Math.floor(2 * matchesPerMinute * matchMinutes),
    roomsNeededFor50Active: Math.ceil(50 * minutesPerMatch / (2 * matchMinutes)),
    roomsCreatedPer100Matches: Math.round((1 - outcome.rematchShare) * 100),
    dailyBudgetUnitsPer100Matches: 100,
  });
}
console.log(JSON.stringify({ assumptions, scenarios }, null, 2));
