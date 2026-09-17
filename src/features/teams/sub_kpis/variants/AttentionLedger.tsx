// STUB — replaced by WP2 (kpi-strategic-map spark).
import type { KpiVariantProps } from '../KPIDashboard';

export default function AttentionLedger({ overview }: KpiVariantProps) {
  return <div data-testid="kpi-ledger" className="typo-caption text-foreground">{overview.length}</div>;
}
