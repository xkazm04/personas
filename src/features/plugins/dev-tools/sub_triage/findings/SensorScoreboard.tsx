// The Sensor Scoreboard (Phase 3B) — "when this sensor's findings ship, does the
// number actually move?"
//
// Sibling to the Agent Scoreboard, but scored on a strictly better axis. The agent
// board can only ask "did a human accept it and did a PR merge?" — which rewards
// plausibility. A sensor measures a NUMBER, so we can re-measure it after the work
// ships and score on effect. Verify rate is the headline.
//
// Deliberate choices:
//   • An unjudged sensor shows "—", never 0% (unknown ≠ bad).
//   • `unchanged` and `regressed` get their own columns. Hiding them would recreate
//     the exact illusion this phase exists to destroy.
//   • A credible sensor with a poor rate is flagged as NOISY — that's a finding
//     about the finder, and it's advisory (we don't silently retune thresholds).
import { useMemo } from 'react';
import { AlertTriangle, Radar } from 'lucide-react';

import { useSystemStore } from '@/stores/systemStore';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { originMeta } from './FindingBadge';
import {
  computeSensorStats,
  isNoisySensor,
  MIN_VERDICTS_FOR_CREDIBILITY,
  type SensorStats,
} from './sensorStats';

function ratePct(s: SensorStats): string {
  if (s.verifyRate === null) return '—';
  return `${Math.round(s.verifyRate * 100)}%`;
}

function rateColor(s: SensorStats): string {
  if (s.verifyRate === null) return 'text-foreground/40';
  if (isNoisySensor(s)) return 'text-red-300';
  if (s.verifyRate >= 0.67) return 'text-emerald-300';
  return 'text-amber-300';
}

export function SensorScoreboard() {
  const ideas = useSystemStore((s) => s.ideas);
  const stats = useMemo(() => computeSensorStats(ideas), [ideas]);

  // No sensor has raised anything yet — don't show an empty table.
  if (stats.length === 0) return null;

  return (
    <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden" data-testid="sensor-scoreboard">
      <div className="px-4 py-2.5 border-b border-primary/10 flex items-center gap-2">
        <Radar className="w-3.5 h-3.5 text-primary/70" />
        <span className="typo-caption text-foreground">Sensors — did the number move?</span>
        <Tooltip content={`Of the findings that shipped and were judged, how many cleared or improved. "—" = nothing judged yet. Needs ${MIN_VERDICTS_FOR_CREDIBILITY} verdicts before the rate is worth believing.`}>
          <span className="ml-auto typo-label text-foreground/40 cursor-help">verify rate</span>
        </Tooltip>
      </div>

      <table className="w-full">
        <thead>
          <tr className="text-left">
            {['Sensor', 'Raised', 'Shipped', 'Cleared', 'Moved', 'Unchanged', 'Regressed', 'Verify'].map((h) => (
              <th key={h} className="px-3 py-1.5 typo-label text-foreground/45 font-normal">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-primary/5">
          {stats.map((s) => {
            const meta = originMeta(s.origin);
            const Icon = meta?.icon;
            const noisy = isNoisySensor(s);
            return (
              <tr key={s.origin} className="hover:bg-primary/[0.02]">
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    {Icon && <Icon className="w-3 h-3 text-foreground/60" aria-hidden />}
                    <span className="typo-caption text-foreground">{meta?.label ?? s.origin}</span>
                    {noisy && (
                      <Tooltip content="This sensor's findings ship and the number doesn't move — its threshold is probably wrong, or it's pointing at work that doesn't pay.">
                        <span className="inline-flex items-center gap-0.5 text-red-300 typo-label cursor-help">
                          <AlertTriangle className="w-3 h-3" aria-hidden />
                          noisy
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="px-3 py-1.5 typo-caption text-foreground/70 tabular-nums">{s.raised}</td>
                <td className="px-3 py-1.5 typo-caption text-foreground/70 tabular-nums">{s.verdicted}</td>
                <td className="px-3 py-1.5 typo-caption text-emerald-300 tabular-nums">{s.cleared || '·'}</td>
                <td className="px-3 py-1.5 typo-caption text-sky-300 tabular-nums">{s.moved || '·'}</td>
                <td className="px-3 py-1.5 typo-caption text-amber-300 tabular-nums">{s.unchanged || '·'}</td>
                <td className="px-3 py-1.5 typo-caption text-red-300 tabular-nums">{s.regressed || '·'}</td>
                <td className={`px-3 py-1.5 typo-caption tabular-nums font-medium ${rateColor(s)}`}>
                  {ratePct(s)}
                  {!s.hasEnoughSignal && s.verifyRate !== null && (
                    <span className="ml-1 text-foreground/35 typo-label">(low n)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
