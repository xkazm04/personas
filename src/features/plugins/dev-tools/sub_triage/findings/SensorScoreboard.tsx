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
import { originMeta, useOriginLabel } from './findingOrigins';
import { TONE_TEXT } from '../triageTones';
import { SkippedSensorChips } from './SkippedSensorChips';
import { useLastSweep } from './lastSweep';
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

/** The rate is a status: good, middling, noise. Unknown is a caption, never a colour. */
function rateClass(s: SensorStats): string {
  if (s.verifyRate === null) return 'typo-caption';
  if (isNoisySensor(s)) return `typo-caption ${TONE_TEXT.error}`;
  if (s.verifyRate >= 0.67) return `typo-caption ${TONE_TEXT.success}`;
  return `typo-caption ${TONE_TEXT.warning}`;
}

export function SensorScoreboard({ projectId = null }: { projectId?: string | null }) {
  const ideas = useSystemStore((s) => s.ideas);
  const originLabel = useOriginLabel();
  const stats = useMemo(() => computeSensorStats(ideas), [ideas]);
  const lastSweep = useLastSweep(projectId);
  const skipped = lastSweep?.skippedSensors ?? [];

  // Nothing raised AND nothing skipped: there is genuinely nothing to report.
  // Nothing raised but sensors SKIPPED is a different state and used to render
  // as this same `null` — a first sweep on an unwired project looked identical
  // to a clean one (`failure-not-empty-success`).
  if (stats.length === 0 && skipped.length === 0) return null;

  return (
    <div className="rounded-card border border-primary/10 bg-card/30 overflow-hidden" data-testid="sensor-scoreboard">
      <div className="px-4 py-2.5 border-b border-primary/10 flex items-center gap-2">
        <Radar className="w-3.5 h-3.5 text-primary/70" />
        <span className="typo-caption text-foreground">Sensors — did the number move?</span>
        <Tooltip content={`Of the findings that shipped and were judged, how many cleared or improved. "—" = nothing judged yet. Needs ${MIN_VERDICTS_FOR_CREDIBILITY} verdicts before the rate is worth believing.`}>
          <span className="ml-auto typo-caption cursor-help">verify rate</span>
        </Tooltip>
      </div>

      <SkippedSensorChips skipped={skipped} />

      {/* style-deviation: a raw <table>, not UnifiedTable. Eight fixed columns derived from the store, never loading, never sorted or paged: the shared table's ghost, virtual rows and entrance cascade have nothing to do here. */}
      {stats.length > 0 && (
      <table className="w-full">
        <thead>
          <tr className="text-left">
            {['Sensor', 'Raised', 'Shipped', 'Cleared', 'Moved', 'Unchanged', 'Regressed', 'Verify'].map((h) => (
              <th key={h} className="px-3 py-1.5 typo-label text-foreground">
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
              <tr key={s.origin} className="hover:bg-primary/2">
                <td className="px-3 py-1.5">
                  <span className="inline-flex items-center gap-1.5">
                    {Icon && <Icon className="w-3 h-3 text-foreground" aria-hidden />}
                    <span className="typo-caption text-foreground">{originLabel(s.origin)}</span>
                    {noisy && (
                      <Tooltip content="This sensor's findings ship and the number doesn't move — its threshold is probably wrong, or it's pointing at work that doesn't pay.">
                        <span className={`inline-flex items-center gap-0.5 typo-label cursor-help ${TONE_TEXT.error}`}>
                          <AlertTriangle className="w-3 h-3" aria-hidden />
                          noisy
                        </span>
                      </Tooltip>
                    )}
                  </span>
                </td>
                <td className="px-3 py-1.5 typo-caption tabular-nums">{s.raised}</td>
                <td className="px-3 py-1.5 typo-caption tabular-nums">{s.verdicted}</td>
                <td className={`px-3 py-1.5 typo-caption tabular-nums ${TONE_TEXT.success}`}>{s.cleared || '·'}</td>
                <td className={`px-3 py-1.5 typo-caption tabular-nums ${TONE_TEXT.info}`}>{s.moved || '·'}</td>
                <td className={`px-3 py-1.5 typo-caption tabular-nums ${TONE_TEXT.warning}`}>{s.unchanged || '·'}</td>
                <td className={`px-3 py-1.5 typo-caption tabular-nums ${TONE_TEXT.error}`}>{s.regressed || '·'}</td>
                <td className={`px-3 py-1.5 tabular-nums ${rateClass(s)}`}>
                  {ratePct(s)}
                  {!s.hasEnoughSignal && s.verifyRate !== null && (
                    <span className="ml-1 typo-caption">(low n)</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}
