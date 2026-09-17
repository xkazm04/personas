// STUB — replaced by WP3 (kpi-strategic-map spark).
import type { KpiVariantProps } from '../KPIDashboard';

export default function PortfolioTreemap({ overview }: KpiVariantProps) {
  return <div data-testid="kpi-treemap" className="typo-caption text-foreground">{overview.length}</div>;
}
