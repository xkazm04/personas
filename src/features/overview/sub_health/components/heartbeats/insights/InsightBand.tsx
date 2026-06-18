import type { PersonaHealthSignal, CascadeLink, RoutingRecommendation } from '@/stores/slices/overview/personaHealthSlice';
import { AlertsPanel } from './AlertsPanel';
import { BurnPanel } from './BurnPanel';
import { CascadePanel } from './CascadePanel';

// ---------------------------------------------------------------------------
// Insight band — the three recomposed panels as one cohesive, equal-height
// premium row beneath the Vitals Ledger.
// ---------------------------------------------------------------------------

export function InsightBand({ signals, cascadeLinks, recommendations }: {
  signals: PersonaHealthSignal[];
  cascadeLinks: CascadeLink[];
  recommendations: RoutingRecommendation[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
      <AlertsPanel signals={signals} recommendations={recommendations} />
      <BurnPanel signals={signals} />
      <CascadePanel links={cascadeLinks} signals={signals} />
    </div>
  );
}
