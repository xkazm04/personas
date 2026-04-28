import { useState } from 'react';
import { Sparkles, GitCommit, Gauge } from 'lucide-react';
import { LabVariantTabs } from '../../shared/LabVariantTabs';
import { EvolutionPanelBaseline } from './EvolutionPanelBaseline';
import { EvolutionPanelLineage } from './EvolutionPanelLineage';
import { EvolutionPanelMission } from './EvolutionPanelMission';

type EvolutionVariant = 'baseline' | 'lineage' | 'mission';

const TABS = [
  { id: 'baseline' as const, label: 'Baseline',       subtitle: 'Settings + cycle list', icon: Sparkles, testId: 'evo-variant-baseline' },
  { id: 'lineage'  as const, label: 'Lineage',        subtitle: 'Genome + generation tree', icon: GitCommit, testId: 'evo-variant-lineage' },
  { id: 'mission'  as const, label: 'Mission Control', subtitle: 'Reactor + filmstrip', icon: Gauge, testId: 'evo-variant-mission' },
];

export function EvolutionPanel() {
  const [variant, setVariant] = useState<EvolutionVariant>('baseline');

  return (
    <div className="space-y-3">
      <LabVariantTabs<EvolutionVariant>
        tabs={TABS}
        activeId={variant}
        onChange={setVariant}
        ariaLabel="Evolution panel variant"
      />
      {variant === 'baseline' && <EvolutionPanelBaseline />}
      {variant === 'lineage' && <EvolutionPanelLineage />}
      {variant === 'mission' && <EvolutionPanelMission />}
    </div>
  );
}
