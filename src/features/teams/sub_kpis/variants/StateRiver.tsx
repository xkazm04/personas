// STUB — replaced by WP3 (kpi-strategic-map spark).
import type { KpiVariantProps } from '../KPIDashboard';

export default function StateRiver({ overview }: KpiVariantProps) {
  return <div data-testid="kpi-river" className="typo-caption text-foreground">{overview.length}</div>;
}
