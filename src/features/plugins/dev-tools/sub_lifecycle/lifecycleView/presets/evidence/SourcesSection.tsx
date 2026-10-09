/**
 * Outcomes by source, as small multiples: one card per kind of change (task,
 * commit, pull request) with its share of done, skipped, failed and unknown
 * as one proportional bar - so cards with different totals compare by shape -
 * and its done rate. When two kinds that can be judged are far apart, one
 * sentence above the cards says so ("Done in 20% of commits, against 90% of
 * tasks"). Not drawn for a step with no changes.
 */
import { toneColor, Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleSourceKind } from '@/lib/bindings/LifecycleSourceKind';
import { formatNumeric } from '@/lib/utils/formatters';

import { outcomeLabel, sourceKindGlyph, sourceKindLabel } from '../../../journey/journeyLabels';
import { useLifecycleViewModel } from '../../context';
import { lcSurface, RHYTHM } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { GLYPH } from '../../system/scales';
import { OUTCOME_MARK } from '../EvidenceRows';
import { OUTCOME_ORDER } from './evidenceModel';
import { sourceContrast, type SourceSlice } from './sources';

type Dl = ReturnType<typeof useLifecycleViewModel>['dl'];

function kindsNoun(dl: Dl, kind: LifecycleSourceKind): string {
  return { task: dl.lcx8_kinds_task, commit: dl.lcx8_kinds_commit, pr: dl.lcx8_kinds_pr }[kind];
}

function SourceCard({ s }: { s: SourceSlice }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const Glyph = sourceKindGlyph(s.kind);
  const parts = OUTCOME_ORDER.filter((o) => s.counts[o] > 0);
  return (
    <div className={`${lcSurface('card')} ${RHYTHM.tight}`} data-testid={`lc8-source-${s.kind}`} data-rate={s.ratePct ?? ''}>
      <div className="flex items-center gap-2">
        <Glyph className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
        <span className={`flex-1 ${LT.title}`}>{sourceKindLabel(dl, s.kind)}</span>
        <span className={LT.metaNum}>{s.total === 1 ? dl.lcx8_source_changes_one : tx(dl.lcx8_source_changes, { count: s.total })}</span>
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-pill bg-secondary/60" role="img" aria-label={parts.map((o) => `${outcomeLabel(dl, o)} ${s.counts[o]}`).join(', ')}>
        {parts.map((o) => (
          <span key={o} className="h-full" style={{ width: `${(s.counts[o] / s.total) * 100}%`, background: toneColor(OUTCOME_MARK[o].tone) }} />
        ))}
      </div>
      <p className={s.judged ? LT.row : LT.meta}>
        {s.judged && s.ratePct != null
          ? tx(dl.lcx8_source_rate, { rate: formatNumeric(s.ratePct, 'percent', { precision: 0, language }) })
          : dl.lcx8_source_too_few}
      </p>
    </div>
  );
}

export function SourcesSection({ sources }: { sources: SourceSlice[] }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  if (sources.length === 0) return null;
  const contrast = sourceContrast(sources);
  const pct = (v: number | null) => formatNumeric(v, 'percent', { precision: 0, language });
  return (
    <Section title={dl.lcx8_sources_title} level={2} desc={dl.lcx8_sources_desc}>
      <div className={`k-in ${RHYTHM.block}`} data-testid="lc8-sources">
        {contrast && (
          <p className={`${lcSurface('plate')} ${LT.lead}`} data-testid="lc8-source-contrast">
            {tx(dl.lcx8_source_contrast, {
              lowRate: pct(contrast.low.ratePct), low: kindsNoun(dl, contrast.low.kind),
              highRate: pct(contrast.high.ratePct), high: kindsNoun(dl, contrast.high.kind),
            })}
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {sources.map((s) => <SourceCard key={s.kind} s={s} />)}
        </div>
      </div>
    </Section>
  );
}
