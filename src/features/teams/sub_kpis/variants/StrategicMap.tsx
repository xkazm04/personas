// STUB — replaced by WP1 (kpi-strategic-map spark).
import type { KpiVariantProps } from '../KPIDashboard';

export default function StrategicMap({ overview }: KpiVariantProps) {
  return <div data-testid="kpi-map" className="typo-caption text-foreground">{overview.length}</div>;
}
