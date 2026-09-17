// STUB — replaced by WP2 (kpi-strategic-map spark).
import type { KpiVariantProps } from '../KPIDashboard';

export default function ProjectGrid({ overview }: KpiVariantProps) {
  return <div data-testid="kpi-grid" className="typo-caption text-foreground">{overview.length}</div>;
}
