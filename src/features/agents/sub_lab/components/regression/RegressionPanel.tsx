import { useState } from 'react';
import { ShieldCheck, ShieldAlert, Gauge } from 'lucide-react';
import { LabVariantTabs } from '../../shared/LabVariantTabs';
import { RegressionPanelBaseline } from './RegressionPanelBaseline';
import { RegressionPanelGate } from './RegressionPanelGate';
import { RegressionPanelConsole } from './RegressionPanelConsole';

type RegressionVariant = 'baseline' | 'gate' | 'console';

const TABS = [
  { id: 'baseline' as const, label: 'Baseline',      subtitle: 'Linear form + delta table',     icon: ShieldCheck, testId: 'reg-variant-baseline' },
  { id: 'gate'     as const, label: 'Quality Gate',  subtitle: '3-stage checkpoint flow',        icon: ShieldAlert, testId: 'reg-variant-gate' },
  { id: 'console'  as const, label: 'Safety Console', subtitle: 'Cockpit head-to-head + lights', icon: Gauge,        testId: 'reg-variant-console' },
];

export function RegressionPanel() {
  const [variant, setVariant] = useState<RegressionVariant>('baseline');

  return (
    <div className="space-y-3">
      <LabVariantTabs<RegressionVariant>
        tabs={TABS}
        activeId={variant}
        onChange={setVariant}
        ariaLabel="Regression panel variant"
      />
      {variant === 'baseline' && <RegressionPanelBaseline />}
      {variant === 'gate' && <RegressionPanelGate />}
      {variant === 'console' && <RegressionPanelConsole />}
    </div>
  );
}
