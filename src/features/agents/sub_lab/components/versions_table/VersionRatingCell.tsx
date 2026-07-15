import { Star, TriangleAlert } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { VersionRow } from '../../libs/versionMatrixRows';

function scoreColor(c: number): string {
  if (c >= 80) return 'text-emerald-400';
  if (c >= 60) return 'text-amber-300';
  return 'text-red-400';
}

const fmt = (n: number | null) => (n == null ? '—' : String(Math.round(n)));

/**
 * Rating cell: the weighted composite (0–100) with a per-version ★ on the
 * best-scoring model, and a tooltip breaking out the sub-scores + sample count.
 * When the score is not fully trustworthy — some samples fell back to the
 * degraded keyword heuristic (LLM judge failed/timed out), or the composite was
 * renormalised over partial sub-score coverage — an amber warning marks the cell
 * and the tooltip explains why, so a degraded number is never read as equivalent
 * to a clean LLM-judged one.
 */
export function VersionRatingCell({ row }: { row: VersionRow }) {
  const { t, tx } = useTranslation();
  const lab = t.agents.lab;

  if (row.composite == null || !row.rating) {
    return <span className="typo-caption text-foreground tabular-nums">{lab.vr_unmeasured}</span>;
  }

  const c = Math.round(row.composite);
  const r = row.rating;
  const samples = tx(r.sampleCount === 1 ? lab.vr_samples : lab.vr_samples_other, { count: r.sampleCount });
  const degraded = r.degradedCount > 0;
  const partial = r.partialCoverage;

  const parts = [`T ${fmt(r.toolAccuracy)} · Q ${fmt(r.outputQuality)} · P ${fmt(r.protocolCompliance)} — ${samples}`];
  if (degraded) parts.push(tx(lab.vr_degraded_tooltip, { count: r.degradedCount, total: r.sampleCount }));
  if (partial) parts.push(lab.vr_partial_tooltip);
  const tip = parts.join(' · ');

  return (
    <Tooltip content={tip}>
      <span className="inline-flex items-center gap-1 tabular-nums">
        <span className={`typo-body font-semibold ${scoreColor(c)}`}>{c}</span>
        {(degraded || partial) && (
          <TriangleAlert className="w-3 h-3 text-amber-400" aria-label={lab.vr_score_caution} />
        )}
        {row.isBestForVersion && <Star className="w-3 h-3 text-amber-300 fill-amber-300" aria-hidden />}
      </span>
    </Tooltip>
  );
}
