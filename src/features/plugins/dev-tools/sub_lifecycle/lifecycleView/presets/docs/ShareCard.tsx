// The clean share, honestly: the share the step is judged by (the snapshot's
// metric, n = the verifiable docs), drawn on a track against the line it must
// reach - the step's own `docsCleanPct` when it sets one, else the rules' -
// with how many more clean docs would reach it, and which docs are left out
// of the count and why (an unverifiable doc names no source the scan can
// check, so it is neither clean nor rotten). The ring above is the step's
// instrument; this card is what the ring cannot say.
import { motion } from 'framer-motion';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { VERDICT, type HealthStep } from '../../layer1/healthModel';
import { MetricValue } from '../../layer1/parts/MetricValue';
import { useEntrance } from '../../system/entrance';
import { lcSurface, RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { thresholdsFor } from '../../system/rules';
import { useSnapshotRules } from '../../system/useSnapshotRules';
import type { StatusCounts } from './estateModel';

/** Clean docs still missing for `clean / verifiable` to reach `line` percent (0 when it already does). */
export function cleanDocsNeeded(clean: number, verifiable: number, line: number): number {
  if (verifiable <= 0) return 0;
  return Math.max(0, Math.ceil((line * verifiable) / 100 - 1e-9) - clean);
}

function Track({ share, line, fill }: { share: number; line: number; fill: string }) {
  const entering = useEntrance();
  const reduced = useReducedMotion();
  const clamp = (v: number) => `${Math.max(0, Math.min(100, v))}%`;
  return (
    <span aria-hidden className="relative block py-1" data-testid="lcx7-share-track">
      <span className="block h-2.5 w-full rounded-pill bg-primary/10" />
      <motion.span
        className={`absolute left-0 top-1 h-2.5 rounded-pill ${fill}`}
        initial={entering ? { width: '0%' } : false}
        animate={{ width: clamp(share) }}
        transition={reduced ? { duration: 0 } : { duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
      <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-pill bg-foreground" style={{ left: clamp(line) }} data-line={line} />
    </span>
  );
}

export function ShareCard({ step, node, counts }: { step: HealthStep; node: JourneyNode; counts: StatusCounts }) {
  const { dl, tx } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const own = node.view.step.params.docsCleanPct;
  const line = thresholdsFor(rules, node.view.step.params).docsCleanPct;
  const metric = step.metrics.find((m) => m.key === 'docs_clean_pct') ?? null;
  const verifiable = counts.broken + counts.stale + counts.clean;
  const share = metric?.value ?? (verifiable > 0 ? (counts.clean * 100) / verifiable : null);
  const need = cleanDocsNeeded(counts.clean, verifiable, line);
  const v = VERDICT[step.health];
  return (
    <div className={`flex w-full shrink-0 flex-col ${RHYTHM.tight} ${lcSurface('card')} sm:w-72`} data-testid="lc2-docs-share">
      <span className={LT.eyebrow}>{dl.lcx7_share}</span>
      <span className="flex items-baseline gap-2">
        {metric && <MetricValue metric={metric} className={`${LT.stat} ${v.ink}`} />}
        <span className={LT.row}>{dl.lc1_metric_docs_clean_pct}</span>
      </span>
      {share != null && verifiable > 0 ? (
        <>
          <span className={LT.row}>{tx(dl.lc2_docs_verifiable, { count: metric?.samples ?? verifiable })}</span>
          <Track share={share} line={line} fill={v.fill || 'bg-primary/40'} />
        </>
      ) : (
        <span className={LT.row} data-testid="lcx7-share-none">{dl.lcx7_share_none}</span>
      )}
      <span className={`flex flex-wrap items-baseline gap-x-1.5 ${LT.meta}`}>
        {dl.lc2_docs_threshold}
        <Numeric value={line} unit="percent" precision={0} className={LT.rowNum} />
        <span>{own != null ? dl.lcx7_line_step : dl.lcx7_line_default}</span>
      </span>
      {verifiable > 0 && (
        <span className={`${LT.row} ${need > 0 ? 'text-status-warning' : 'text-status-success'}`} data-testid="lcx7-share-need">
          {need === 0 ? dl.lcx7_share_met : need === 1 ? dl.lcx7_share_need_one : tx(dl.lcx7_share_need, { count: need })}
        </span>
      )}
      {counts.unverifiable > 0 && (
        <span className={LT.meta} data-testid="lcx7-share-excluded">
          {counts.unverifiable === 1 ? dl.lcx7_excluded_one : tx(dl.lcx7_excluded, { count: counts.unverifiable })}
        </span>
      )}
    </div>
  );
}
