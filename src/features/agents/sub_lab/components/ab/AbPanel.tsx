import { useState } from 'react';
import { Scale, Swords, Beaker } from 'lucide-react';
import { LabVariantTabs } from '../../shared/LabVariantTabs';
import { AbPanelBaseline } from './AbPanelBaseline';
import { AbPanelStudio } from './AbPanelStudio';
import { AbPanelBench } from './AbPanelBench';

type AbVariant = 'baseline' | 'studio' | 'bench';

const TABS = [
  { id: 'baseline' as const, label: 'Baseline', subtitle: 'Two pickers + diff',          icon: Scale,  testId: 'ab-variant-baseline' },
  { id: 'studio'   as const, label: 'Studio',   subtitle: 'Tale of the tape',            icon: Swords, testId: 'ab-variant-studio' },
  { id: 'bench'    as const, label: 'Bench',    subtitle: 'Specimen rail + comparator',  icon: Beaker, testId: 'ab-variant-bench' },
];

export function AbPanel() {
  const [variant, setVariant] = useState<AbVariant>('baseline');

  return (
    <div className="space-y-3">
      <LabVariantTabs<AbVariant>
        tabs={TABS}
        activeId={variant}
        onChange={setVariant}
        ariaLabel="A/B panel variant"
      />
      {variant === 'baseline' && <AbPanelBaseline />}
      {variant === 'studio' && <AbPanelStudio />}
      {variant === 'bench' && <AbPanelBench />}
    </div>
  );
}
