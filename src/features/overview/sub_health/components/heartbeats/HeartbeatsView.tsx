import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';
import { CircuitBreakerIndicator } from '@/features/agents/sub_executions/components/CircuitBreakerIndicator';
import { debtText } from '@/i18n/DebtText';
import type {
  PersonaHealthSignal, CascadeLink, RoutingRecommendation,
  DataSourceStatusMap, DataSourceName,
} from '@/stores/slices/overview/personaHealthSlice';
import { useHeartbeatsModel, DATA_SOURCE_LABELS } from './model';
import { VitalsLedger } from './VitalsLedger';

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
    </div>
  );
}

function StalenessBanner({ status, onRetry }: { status: DataSourceStatusMap; onRetry: () => void }) {
  const failedSources = (Object.entries(status) as [DataSourceName, string][])
    .filter(([, state]) => state === 'failed')
    .map(([name]) => DATA_SOURCE_LABELS[name]);

  if (failedSources.length === 0) return null;

  const detail = `${failedSources.join(', ')} could not be loaded — scores may be inaccurate.`;

  return (
    <InlineErrorBanner
      severity="warning"
      title={debtText('auto_incomplete_health_data_a49b15ba')}
      message={detail}
      onRetry={onRetry}
    />
  );
}
