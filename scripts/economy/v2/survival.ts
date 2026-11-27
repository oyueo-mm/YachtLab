/** Kaplan–Meier median with a Greenwood log–log 95% interval. Null means the curve did not cross 50%. */
export function survivalTimes(observations: { event: number | null; censor: number }[]) {
  const rows = observations.map(({ event, censor }) => ({ t: event ?? censor, event: event !== null }))
    .sort((a, b) => a.t - b.t);
  let atRisk = rows.length, survival = 1, variance = 0;
  let median: number | null = null, lo: number | null = null, hi: number | null = null;
  for (let i = 0; i < rows.length;) {
    const t = rows[i].t;
    let n = 0, deaths = 0;
    while (i < rows.length && rows[i].t === t) {
      n++;
      if (rows[i++].event) deaths++;
    }
    if (deaths) {
      survival *= 1 - deaths / atRisk;
      if (deaths < atRisk) variance += deaths / (atRisk * (atRisk - deaths));
      const logSurvival = Math.log(survival);
      const spread = 1.96 * Math.sqrt(variance) / Math.abs(logSurvival);
      if (survival === 0 || Math.exp(logSurvival * Math.exp(spread)) <= 0.5) lo ??= t;
      if (survival <= 0.5) median ??= t;
      if (survival === 0 || Math.exp(logSurvival * Math.exp(-spread)) <= 0.5) hi ??= t;
    }
    atRisk -= n;
  }
  return { median, lo, hi, reached: rows.filter((row) => row.event).length / Math.max(1, rows.length) };
}
