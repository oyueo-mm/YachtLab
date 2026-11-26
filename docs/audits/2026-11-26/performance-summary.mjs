// Summarize Lighthouse reports without preserving environment, cookies, or full traces.
import { readFile } from 'node:fs/promises';
const metrics = ['first-contentful-paint', 'largest-contentful-paint', 'cumulative-layout-shift',
  'total-blocking-time', 'speed-index', 'total-byte-weight'];
const summaries = [];
for (const file of process.argv.slice(2)) {
  const report = JSON.parse(await readFile(file, 'utf8'));
  const { audits, categories, configSettings } = report;
  summaries.push({
    version: report.lighthouseVersion,
    measuredAt: report.fetchTime,
    formFactor: configSettings.formFactor,
    url: report.finalDisplayedUrl,
    runtimeError: report.runtimeError?.code,
    categories: Object.fromEntries(Object.entries(categories).map(([id, value]) => [id, value.score])),
    metrics: Object.fromEntries(metrics.map(id => [id, audits[id]?.numericValue ?? null])),
    resources: (audits['network-requests']?.details?.items ?? []).map(item => {
      const url = new URL(item.url);
      return { path: url.pathname, transferBytes: item.transferSize, decodedBytes: item.resourceSize };
    }),
    accessibility: Object.fromEntries(categories.accessibility.auditRefs.flatMap(({ id }) =>
      audits[id]?.score === 0 ? [[id, (audits[id].details?.items ?? []).map(item => item.node?.selector)]] : [])),
  });
}
console.log(JSON.stringify(summaries, null, 2));
