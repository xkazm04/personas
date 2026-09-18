// KPI dashboard — a DISPATCHER over six overview renderers behind one
// persisted switch (kpi-strategic-map spark, 2026-09-17): the untouched
// classic board and five strategic prototypes (map, ledger, treemap, grid,
// river). Every strategic variant reads the same overview model and opens
// the same in-place Project › Group layer; the winner is consolidated later.
import { Suspense, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { lazyRetry } from '@/lib/lazyRetry';
import { SuspenseFallback } from '@/features/shared/components/feedback/SuspenseFallback';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { KPIS_GLYPH } from '@/features/shared/glyph/glyphs/kpisGlyph';

import { KpiClassicDashboard } from './classic/KpiClassicDashboard';
import { KpiVariantSwitcher } from './KpiVariantSwitcher';
import { useKpiVariant, type KpiVariant } from './kpiVariant';
import { useKpiOverview } from './useKpiOverview';
import type { KpiFocus, KpiProjectRollup } from './kpiOverviewModel';

export { buildProjectGroups } from './classic/KpiClassicDashboard';

/** The contract every strategic variant renders against. */
export interface KpiVariantProps {
  overview: KpiProjectRollup[];
  loading: boolean;
  onFocus: (focus: KpiFocus) => void;
  onOpen: (kpiId: string) => void;
}

const StrategicMap = lazyRetry(() => import('./variants/StrategicMap'));
const AttentionLedger = lazyRetry(() => import('./variants/AttentionLedger'));
const PortfolioTreemap = lazyRetry(() => import('./variants/PortfolioTreemap'));
const ProjectGrid = lazyRetry(() => import('./variants/ProjectGrid'));
const StateRiver = lazyRetry(() => import('./variants/StateRiver'));
const KpiGroupLayer = lazyRetry(() => import('./layer/KpiGroupLayer'));

const VARIANT_COMPONENT: Record<Exclude<KpiVariant, 'classic'>, React.ComponentType<KpiVariantProps>> = {
  map: StrategicMap,
  ledger: AttentionLedger,
  treemap: PortfolioTreemap,
  grid: ProjectGrid,
  river: StateRiver,
};

export function KPIDashboard({
  loading,
  onOpen,
  onReviewProposals,
}: {
  loading: boolean;
  onOpen: (kpiId: string) => void;
  onReviewProposals: () => void;
}) {
  const { t } = useTranslation();
  const [variant, setVariant] = useKpiVariant();
  const [focus, setFocus] = useState<KpiFocus | null>(null);
  const onChange = (v: KpiVariant) => { setFocus(null); setVariant(v); };

  return (
    <div data-testid="kpi-dashboard">
      <KpiVariantSwitcher variant={variant} onChange={onChange}>
        {variant === 'classic' ? (
          <KpiClassicDashboard loading={loading} onOpen={onOpen} onReviewProposals={onReviewProposals} />
        ) : (
          <StrategicBody
            variant={variant}
            loading={loading}
            focus={focus}
            onFocus={setFocus}
            onOpen={onOpen}
            onReviewProposals={onReviewProposals}
            emptyTitle={t.kpis.empty_title}
          />
        )}
      </KpiVariantSwitcher>
    </div>
  );
}

function StrategicBody({
  variant,
  loading,
  focus,
  onFocus,
  onOpen,
  onReviewProposals,
  emptyTitle,
}: {
  variant: Exclude<KpiVariant, 'classic'>;
  loading: boolean;
  focus: KpiFocus | null;
  onFocus: (f: KpiFocus | null) => void;
  onOpen: (kpiId: string) => void;
  onReviewProposals: () => void;
  emptyTitle: string;
}) {
  const { t } = useTranslation();
  const { overview, loading: overviewLoading } = useKpiOverview();
  const hasProposals = useSystemStore((s) => s.kpis.some((k) => k.status === 'proposed'));
  const busy = loading || overviewLoading;

  if (!busy && overview.length === 0) {
    return (
      <EmptyState
        glyph={KPIS_GLYPH}
        title={emptyTitle}
        description={hasProposals ? t.kpis.empty_with_proposals_hint : t.kpis.empty_hint}
        action={hasProposals ? { label: t.kpis.review_proposals_cta, onClick: onReviewProposals } : undefined}
      />
    );
  }
  const Variant = VARIANT_COMPONENT[variant];
  return (
    <Suspense fallback={<SuspenseFallback />}>
      {focus ? (
        <KpiGroupLayer focus={focus} overview={overview} onBack={() => onFocus(null)} onOpen={onOpen} />
      ) : (
        <Variant overview={overview} loading={busy} onFocus={onFocus} onOpen={onOpen} />
      )}
    </Suspense>
  );
}
