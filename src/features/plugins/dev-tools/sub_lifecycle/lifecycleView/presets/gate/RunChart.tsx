/**
 * A command's run history as an instrument (`chartModel` draws the geometry):
 * one bar per run, oldest on the left, toned by outcome; a timeout a hatched
 * stub and a run that never started a hollow one; the budget a dashed line
 * across; the middle half of the runs a faint band with the median through
 * it. The run the page's time cursor is on is ringed (`data-mark`).
 *
 * Every row's chart shares one slot count (`slots`), right-aligned, so a bar
 * is the same width on every row and the newest run always sits at the right
 * edge. Hover a bar for its peek; press it to open the run.
 */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric, formatRelativeTime } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { shortSha } from '../../history/parts/Axis';
import { useEntrance } from '../../system/entrance';
import { lcShape } from '../../system/lcSurface';
import { chartModel, type BarKind } from './chartModel';
import { RunPeek } from './RunPeek';
import { useRunCursor } from './useRunCursor';

/** The fill of each kind of bar; a hatch is drawn by `HATCH`. */
const FILL: Record<BarKind, string> = {
  passed: 'bg-status-success',
  over: 'bg-status-warning',
  failed: 'bg-status-error',
  timeout: 'border border-status-warning',
  did_not_run: 'border border-dashed border-foreground/60',
};

export const HATCH: CSSProperties = {
  backgroundImage: 'repeating-linear-gradient(135deg, var(--status-warning) 0 1.5px, transparent 1.5px 4px)',
};

/** A share of the plot height as a CSS length. */
const pct = (v: number) => `${v * 100}%`;

interface RunChartProps {
  runsNewestFirst: LifecycleRun[];
  budgetMs: number | null;
  command: string;
  /** Bar slots every row shares (at least this row's run count). */
  slots: number;
  /** The run to ring: the picked past Measure's. */
  markRunId: string | null;
  onOpen: (run: LifecycleRun) => void;
  testId: string;
}

export function RunChart({ runsNewestFirst, budgetMs, command, slots, markRunId, onOpen, testId }: RunChartProps) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const entering = useEntrance();
  const model = chartModel(runsNewestFirst, budgetMs);
  const { bars } = model;
  const marked = markRunId ? bars.findIndex((b) => b.run.id === markRunId) : -1;
  const cursor = useRunCursor(bars.length, (i) => { if (bars[i]) onOpen(bars[i]!.run); }, marked >= 0 ? marked : null);
  const outcome = { passed: dl.lc2_run_passed, failed: dl.lc2_run_failed, timeout: dl.lc2_run_timeout, did_not_run: dl.lc2_run_did_not_run };
  const peeked = cursor.peekIndex != null ? bars[cursor.peekIndex] : undefined;
  const lead = Math.max(0, slots - bars.length);
  return (
    <div
      {...cursor.listbox}
      aria-label={tx(dl.lcx6_chart_label, { command, count: bars.length })}
      className={`relative h-11 w-full outline-none ${lcShape('chip')} focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60`}
      data-testid={testId}
      data-points={bars.length}
    >
      {model.band && (
        <>
          <span aria-hidden className="pointer-events-none absolute inset-x-0 bg-primary/15" style={{ bottom: pct(model.band.low), height: pct(model.band.high - model.band.low) }} />
          <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-primary/60" style={{ bottom: pct(model.band.median) }} data-median />
        </>
      )}
      <div className="absolute inset-0 grid items-end gap-x-0.5" style={{ gridTemplateColumns: `repeat(${Math.max(slots, bars.length, 1)}, minmax(0, 1fr))` }}>
        {Array.from({ length: lead }, (_, i) => <span key={`lead-${i}`} aria-hidden />)}
        {bars.map((b, i) => (
          <div
            key={b.run.id}
            {...cursor.option(i)}
            aria-label={tx(dl.lcx6_bar_label, {
              outcome: outcome[b.run.outcome],
              time: b.kind === 'did_not_run' ? dl.lc1_na : formatNumeric(b.run.durationMs, 'ms'),
              when: formatRelativeTime(b.run.finishedAt, '', { language }),
              sha: shortSha(b.run.headSha),
            })}
            className={`relative flex h-full cursor-pointer items-end justify-center ${lcShape('pin')} transition-colors duration-150 hover:bg-primary/10 motion-reduce:transition-none ${i === marked ? 'bg-primary/15 ring-2 ring-inset ring-primary' : cursor.keyboard && i === cursor.cursor ? 'ring-2 ring-inset ring-primary/70' : ''}`}
            data-bar={b.kind}
            data-outcome={b.run.outcome}
            data-mark={i === marked ? i : undefined}
          >
            <motion.span
              aria-hidden
              className={`block w-3/5 max-w-5 origin-bottom rounded-t-interactive ${FILL[b.kind]}`}
              style={{ height: pct(b.height), ...(b.kind === 'timeout' ? HATCH : null) }}
              initial={entering ? { scaleY: 0 } : false}
              animate={{ scaleY: 1 }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1], delay: entering ? 0.15 + i * 0.012 : 0 }}
            />
            {b.clipped && (
              <span aria-hidden className="absolute left-1/2 top-0 flex w-3/5 max-w-5 -translate-x-1/2 flex-col gap-0.5" data-break>
                <span className="block h-0.5 w-full -rotate-12 bg-background" />
              </span>
            )}
          </div>
        ))}
      </div>
      {model.budgetAt != null && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 border-t-2 border-dashed border-foreground/70" style={{ bottom: pct(model.budgetAt) }} data-budget />
      )}
      <AnchoredTooltip
        anchor={cursor.anchor}
        content={peeked ? <RunPeek run={peeked.run} budgetMs={budgetMs} viewed={cursor.peekIndex === marked} /> : null}
        placement="top"
      />
    </div>
  );
}
