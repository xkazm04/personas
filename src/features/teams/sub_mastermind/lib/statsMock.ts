// DEMO-ONLY stats: six deterministic per-slug numbers so the demo scene's stat
// stats are evaluable without live data. Real islands get real stats from
// islandStats.buildIslandStats — same keys, same tones, same renderer.
import type { IslandStat } from './islandStats';

/** Deterministic 0..1 hash of a string — stable per-slug demo values. */
function hash01(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return ((h >>> 0) % 1000) / 1000;
}

const toneOf = (pct: number, warnBelow: number, badBelow: number): IslandStat['tone'] =>
  pct < badBelow ? 'bad' : pct < warnBelow ? 'warn' : 'good';

export function mockStats(slug: string): IslandStat[] {
  const h = (key: string) => hash01(`${slug}:${key}`);

  const kpi = Math.round(40 + h('kpi') * 55);
  const errs = Math.round(h('err') * 14);
  const spend = 4 + h('llm') * 38;
  const cov = Math.round(30 + h('cov') * 62);
  const auto = Math.round(30 + h('auto') * 55);
  const prod = Math.round(30 + h('prod') * 60);

  return [
    { key: 'kpi', label: 'KPI', value: `${kpi}%`, tone: toneOf(kpi, 75, 55) },
    { key: 'errors', label: 'Errors', value: `${errs}`, tone: errs === 0 ? 'good' : errs < 5 ? 'warn' : 'bad' },
    { key: 'llm', label: 'LLM 30d', value: `$${spend.toFixed(0)}`, tone: 'info' },
    { key: 'tests', label: 'Tests', value: `${cov}%`, tone: toneOf(cov, 70, 45) },
    { key: 'auto', label: 'Auto', value: `${auto}`, tone: toneOf(auto, 78, 35) },
    { key: 'prod', label: 'Prod', value: `${prod}`, tone: toneOf(prod, 78, 35) },
  ];
}
