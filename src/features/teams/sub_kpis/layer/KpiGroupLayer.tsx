// STUB — replaced by WP4 (kpi-strategic-map spark). The in-place
// Project › Group layer every strategic variant opens.
import type { KpiFocus, KpiProjectRollup } from '../kpiOverviewModel';

export interface KpiGroupLayerProps {
  focus: KpiFocus;
  overview: KpiProjectRollup[];
  onBack: () => void;
  onOpen: (kpiId: string) => void;
}

export default function KpiGroupLayer({ focus, onBack }: KpiGroupLayerProps) {
  return (
    <div data-testid="kpi-group-layer">
      <button type="button" data-testid="kpi-layer-back" onClick={onBack} className="typo-caption focus-ring">
        {focus.projectId} › {focus.groupId ?? '*'}
      </button>
    </div>
  );
}
