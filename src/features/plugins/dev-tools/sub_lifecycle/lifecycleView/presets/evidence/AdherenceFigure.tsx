/**
 * The done rate over time as columns against the target: one column per week
 * (or per ten changes on a short record), its height the rate, its fill the
 * verdict that rate would earn (green at the target, at risk from the amber
 * floor, red under it). A column with fewer changes than the rules judge is
 * drawn HOLLOW and dashed: a hint, not a rate. A week without changes keeps
 * its slot with a baseline tick, so a quiet stretch reads as one. Each column
 * says its period, rate and n on hover; the same sentences are a list for a
 * screen reader. The columns rise once, the first time this step is seen.
 */
import { motion } from 'framer-motion';

import { ChartFrame, Hint } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { useFirstEntrance } from '../../system/entrance';
import { LT } from '../../system/lcType';
import { CHANGES_PER_BUCKET, type Adherence, type AdherenceBucket } from './adherence';
import { useBucketWords } from './useBucketWords';

/** The plot's height in px, and the period labels' line under it. */
const PLOT_PX = 136;
const LABELS_PX = 26;
/** A judged 0% still shows a sliver, so it reads as measured, not missing. */
const MIN_BAR_PX = 3;
/** A hollow column (too few to judge) stays tall enough to read as an outline. */
const MIN_HOLLOW_PX = 12;
/** The right margin the columns leave for the target line's label (literal classes, so Tailwind sees them). */
const MARGIN = { inset: 'right-24', pad: 'pr-24' } as const;
/** Period labels drawn under the axis at most; the rest are on hover. */
const MAX_LABELS = 7;

function fillOf(b: AdherenceBucket, target: number, amber: number): string {
  if (!b.judged) return 'border-2 border-dashed border-foreground/50 bg-transparent';
  const r = b.ratePct ?? 0;
  return r >= target ? 'bg-status-success' : r >= amber ? 'bg-status-warning' : 'bg-status-error';
}

function Column({ b, i, target, amber, rise, mode }: { b: AdherenceBucket; i: number; target: number; amber: number; rise: boolean; mode: Adherence['mode'] }) {
  const words = useBucketWords(mode);
  const sentence = words.sentence(b);
  const height = b.n === 0 ? 0 : Math.max(b.judged ? MIN_BAR_PX : MIN_HOLLOW_PX, Math.round(((b.ratePct ?? 0) / 100) * PLOT_PX));
  return (
    <Hint content={sentence}>
      <span
        className="relative flex h-full min-w-0 flex-1 items-end justify-center rounded-t-interactive hover:bg-primary/5"
        data-testid={`lc8-bar-${b.key}`}
        data-judged={b.judged ? 'true' : 'false'}
        data-empty={b.n === 0 ? 'true' : 'false'}
      >
        {b.n === 0 ? (
          <span className="h-0.5 w-2 rounded-pill bg-primary/30" />
        ) : (
          <motion.span
            className={`block w-full max-w-14 rounded-t-interactive ${fillOf(b, target, amber)}`}
            style={{ height: `${height}px`, transformOrigin: 'bottom' }}
            initial={rise ? { scaleY: 0 } : false}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.4, delay: rise ? i * 0.025 : 0, ease: [0.22, 1, 0.36, 1] }}
          />
        )}
      </span>
    </Hint>
  );
}

function Line({ pct, label, dashed, testId }: { pct: number; label?: string; dashed?: boolean; testId?: string }) {
  return (
    <div className="pointer-events-none absolute inset-x-0" style={{ bottom: `${Math.round((pct / 100) * PLOT_PX)}px` }} data-testid={testId}>
      <div className={`border-t-2 ${dashed ? 'border-dotted border-status-warning/50' : 'border-dashed border-primary/70'}`} />
      {label && <span className={`absolute right-0 top-0 -translate-y-1/2 whitespace-nowrap bg-background pl-2 ${LT.label} text-primary`}>{label}</span>}
    </div>
  );
}

export function AdherenceFigure({ series, target, amber, stepKey }: { series: Adherence; target: number; amber: number; stepKey: string }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const words = useBucketWords(series.mode);
  const rise = useFirstEntrance(`adherence:${stepKey}`);
  const { buckets } = series;
  const every = Math.max(1, Math.ceil(buckets.length / MAX_LABELS));
  const pct = formatNumeric(target, 'percent', { precision: 0, language });
  const label = series.mode === 'week'
    ? tx(dl.lcx8_figure_week, { target: pct })
    : tx(dl.lcx8_figure_changes, { size: CHANGES_PER_BUCKET, target: pct });
  return (
    <ChartFrame height={PLOT_PX + LABELS_PX} label={label}>
      <div className="flex h-full flex-col" data-testid="lc8-adherence" data-mode={series.mode} aria-hidden>
        <div className="relative border-b border-primary/20" style={{ height: `${PLOT_PX}px` }}>
          <Line pct={amber} dashed />
          <Line pct={target} label={tx(dl.lcx8_target, { target: pct })} testId="lc8-target" />
          <div className={`absolute inset-y-0 left-0 ${MARGIN.inset} flex items-end gap-1.5`}>
            {buckets.map((b, i) => <Column key={b.key} b={b} i={i} target={target} amber={amber} rise={rise} mode={series.mode} />)}
          </div>
        </div>
        <div className={`flex gap-1.5 pt-1.5 ${MARGIN.pad}`}>
          {buckets.map((b, i) => (
            <span key={b.key} className={`min-w-0 flex-1 truncate text-center ${LT.metaNum}`}>
              {i % every === 0 || i === buckets.length - 1 ? words.short(b) : ''}
            </span>
          ))}
        </div>
      </div>
      <ul className="sr-only">
        {buckets.map((b) => <li key={b.key}>{words.sentence(b)}</li>)}
      </ul>
    </ChartFrame>
  );
}
