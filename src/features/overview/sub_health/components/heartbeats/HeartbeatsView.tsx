import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { CircuitBreakerIndicator } from '@/features/agents/sub_executions/components/CircuitBreakerIndicator';
import { debtText } from '@/i18n/DebtText';
import { useTranslation, interpolate } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import type {
  PersonaHealthSignal, CascadeLink, RoutingRecommendation,
  DataSourceStatusMap, DataSourceName,
} from '@/stores/slices/overview/personaHealthSlice';
import { useHeartbeatsModel } from './model';
import { VitalsLedger } from './VitalsLedger';
import { HealingEffectivenessPanel } from './HealingEffectivenessPanel';

/** Resolve a data-source name to its localized label. */
function sourceLabel(t: Translations, name: DataSourceName): string {
  const h = t.overview.health_dashboard;
  switch (name) {
    case 'monthlySpend': return h.source_monthly_spend;
    case 'healingIssues': return h.source_healing_issues;
    case 'byomPolicy': return h.source_byom_policy;
    case 'providerStats': return h.source_provider_stats;
  }
}

// ---------------------------------------------------------------------------
// Heartbeats view — invariant safety banners + the Vitals Ledger. The ledger
// won the /prototype A/B; the switcher and the card-grid baseline were retired
// at consolidation.
// ---------------------------------------------------------------------------

interface HeartbeatsViewProps {
  signals: PersonaHealthSignal[];
  cascadeLinks: CascadeLink[];
  routingRecommendations: RoutingRecommendation[];
  loading: boolean;
  error: string | null;
  dataSourceStatus: DataSourceStatusMap | null;
  onRefresh: () => void;
}

export function HeartbeatsView({ signals, cascadeLinks, routingRecommendations, loading, error, dataSourceStatus, onRefresh }: HeartbeatsViewProps) {
  const model = useHeartbeatsModel(signals);

  return (
    <div className="space-y-6">
      {error && (
        <InlineErrorBanner
          severity="error"
          title={debtText('auto_health_computation_failed_fa3f611a')}
          message={error}
          onRetry={onRefresh}
        />
      )}
      {dataSourceStatus && <StalenessBanner status={dataSourceStatus} onRetry={onRefresh} />}
      <CircuitBreakerIndicator />

      <VitalsLedger
        signals={signals}
        model={model}
        loading={loading}
        cascadeLinks={cascadeLinks}
        routingRecommendations={routingRecommendations}
      />

      <HealingEffectivenessPanel />
    </div>
  );
}

function StalenessBanner({ status, onRetry }: { status: DataSourceStatusMap; onRetry: () => void }) {
  const { t } = useTranslation();
  const failed = (Object.entries(status) as [DataSourceName, DataSourceStatusMap[DataSourceName]][])
    .filter(([, s]) => s.state === 'failed');

  if (failed.length === 0) return null;

  const names = failed.map(([name]) => sourceLabel(t, name)).join(', ');
  const detail = interpolate(t.overview.health_dashboard.sources_unavailable, { sources: names });

  return (
    <InlineErrorBanner
      severity="warning"
      title={debtText('auto_incomplete_health_data_a49b15ba')}
      message={detail}
      onRetry={onRetry}
    />
  );
}
