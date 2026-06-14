// Variant — TREND. The context × KPI matrix with a micro-sparkline + value per
// KPI cell, so each row reads as trend lines, not just current state. Best for
// spotting which KPIs are moving the wrong way; click a cell → KPI console.
import { FactoryShell } from './FactoryShell';
import { ContextMatrix } from './ContextMatrix';

export function TrendVariant() {
  return (
    <FactoryShell
      testid="trend-variant"
      bar="meter"
      density="comfortable"
      renderGroups={(args) => <ContextMatrix {...args} cell="spark" />}
    />
  );
}
