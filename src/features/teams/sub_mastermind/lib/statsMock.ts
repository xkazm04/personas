// PROTOTYPE MOCK (round 8, throwaway): six numeric stats per project so the
// stat-panel treatments can be evaluated visually before real sensors are
// wired (KPI rollups, Sentry rates, uptime monitors, coverage, spend caps).
// Deterministic per slug via hash01 — islands differ but never flicker.
import { hash01 } from './hex';

export interface MockStat {
  key: string;
  label: string;
  value: string;
  /** 0..1 gauge fill — already normalized so "full ring" always means good. */
  arc: number;
  tone: 'good' | 'warn' | 'bad' | 'info';
}

const toneOf = (pct: number, warnBelow: number, badBelow: number): MockStat['tone'] =>
  pct < badBelow ? 'bad' : pct < warnBelow ? 'warn' : 'good';

export function mockStats(slug: string): MockStat[] {
  const h = (key: string) => hash01(`${slug}:${key}`);

  const kpi = Math.round(40 + h('kpi') * 55);
  const errRate = h('err') * 2.2;
  const uptime = 97.2 + h('up') * 2.79;
  const cov = Math.round(30 + h('cov') * 62);
  const auto = Math.round(30 + h('auto') * 55);
  const budget = Math.round(20 + h('bud') * 92);

  return [
    { key: 'kpi', label: 'KPI', value: `${kpi}%`, arc: kpi / 100, tone: toneOf(kpi, 75, 55) },
    { key: 'errors', label: 'Errors', value: `${errRate.toFixed(2)}%`, arc: 1 - errRate / 2.5, tone: errRate < 0.1 ? 'good' : errRate < 1 ? 'warn' : 'bad' },
    { key: 'uptime', label: 'Uptime', value: `${uptime.toFixed(2)}%`, arc: (uptime - 97) / 3, tone: toneOf(uptime, 99.5, 98.5) },
    { key: 'coverage', label: 'Tests', value: `${cov}%`, arc: cov / 100, tone: toneOf(cov, 70, 45) },
    { key: 'autonomy', label: 'Auto', value: `${auto}%`, arc: auto / 100, tone: 'info' },
    { key: 'budget', label: 'Budget', value: `${budget}%`, arc: Math.min(1, budget / 100), tone: budget > 100 ? 'bad' : budget > 80 ? 'warn' : 'good' },
  ];
}

export const STAT_TONE_INK: Record<MockStat['tone'], string> = {
  good: 'var(--status-success)',
  warn: 'var(--status-warning)',
  bad: 'var(--status-error)',
  info: 'var(--status-info)',
};
