// Scenario calculator. Uses model inputs rather than querying the service.
const concurrent = [10, 50, 100, 500, 1000, 5000];
const matchesPerDayPerRoom = 8; // Two-hour peak; 15 minutes per match.
const assumptions = {
  peakHours: 2, seats: 2, matchMinutes: 15, finishedHoldMinutes: 30,
  workerHttpPerMatch: 8, durableHttpRpcAlarmPerMatch: 65,
  socketMessagesPerMatch: 120, rowsReadPerMatch: 160, rowsWrittenPerMatch: 140,
  activeSecondsPerRoomMatch: 12, activeSecondsOtherObjectsPerMatch: 3,
  workerCpuMsPerRequest: 2, activeRoomKiB: 64, retainedAccountKiBPerMatch: 24,
  wsUpgradesPerMatch: 4, durationMemoryGB: 0.128,
};
const a = assumptions;
const money = n => Math.round(n * 100) / 100;
const excess = (n, free) => Math.max(0, n - free);
const scenarios = concurrent.map(players => {
  const rooms = players / a.seats;
  const matches = rooms * matchesPerDayPerRoom;
  const rows = matches * a.rowsWrittenPerMatch;
  const reads = matches * a.rowsReadPerMatch;
  const requests = matches * a.workerHttpPerMatch;
  const doRequests = matches * (a.durableHttpRpcAlarmPerMatch + a.socketMessagesPerMatch / 20);
  const cpuMs = requests * a.workerCpuMsPerRequest;
  const duration = matches * (a.activeSecondsPerRoomMatch + a.activeSecondsOtherObjectsPerMatch) * a.durationMemoryGB;
  const storedGbMonth30d = 15 * matches * a.retainedAccountKiBPerMatch * 1024 / 1e9;
  const estimatedPaidUsdMonth = 5 + excess(requests * 30, 10e6) / 1e6 * 0.30 +
    excess(cpuMs * 30, 30e6) / 1e6 * 0.02 +
    excess(doRequests * 30, 1e6) / 1e6 * 0.15 +
    excess(duration * 30, 400000) / 1e6 * 12.50 +
    excess(rows * 30, 50e6) / 1e6 +
    excess(reads * 30, 25e9) / 1e6 * 0.001 +
    excess(storedGbMonth30d, 5) * 0.20;
  return {
    players, rooms, matches, socketsPeak: players, upgrades: matches * a.wsUpgradesPerMatch,
    roomsIncludingFinishedUpper: rooms * (1 + a.finishedHoldMinutes / a.matchMinutes),
    requests, doRequests, cpuMs, duration: money(duration), reads, rows,
    activeRoomMiB: money(rooms * a.activeRoomKiB / 1024),
    accountMiBDay: money(matches * a.retainedAccountKiBPerMatch / 1024),
    accountGBEndOfMonth: money(2 * storedGbMonth30d),
    accountGBMonth: money(storedGbMonth30d),
    estimatedPaidUsdMonth: money(estimatedPaidUsdMonth),
    crossesFreeLimit: requests > 100000 || doRequests > 100000 || duration > 13000 || rows > 100000 || reads > 5000000,
  };
});
console.log(JSON.stringify({ assumptions, scenarios }, null, 2));
