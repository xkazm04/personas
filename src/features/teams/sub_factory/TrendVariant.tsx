// Variant TREND: the context x KPI matrix with a micro-sparkline and value per
// KPI cell, so each row reads as trend lines, not just current state. Best for
// spotting which KPIs are moving the wrong way; click a KPI to open its console.
import { FactoryShell } from './FactoryShell';
import { ContextMatrix } from './ContextMatrix';

export function TrendVariant() {
  return (
    <FactoryShell
      testid="trend-variant"
      renderGroups={(args) => <ContextMatrix {...args} cell="spark" />}
    />
  );
}
