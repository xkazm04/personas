// PROTOTYPE SCAFFOLD — throwaway A/B switcher (deleted at consolidation).
//
// Lets the operator flip between the current Mission Control baseline and the
// "Consolidated" direction (one monitoring surface: Vitals+trend, status
// monitor, leaderboard matrix, self-healing panel; Instruments/Todos/Stream
// removed). Consolidated is the default because the direction is a decided
// brief, not an open exploration — baseline stays one click away for A/B.

import { useState } from 'react';
import DashboardHomeMissionControl from './DashboardHomeMissionControl';
import MissionControlConsolidated from './consolidated/MissionControlConsolidated';

type VariantKey = 'consolidated' | 'baseline';

const VARIANTS: { key: VariantKey; label: string; sub: string }[] = [
  { key: 'consolidated', label: 'Consolidated', sub: 'one monitoring surface' },
  { key: 'baseline', label: 'Baseline', sub: 'current cockpit' },
];

export default function MissionControlSwitcher() {
  const [variant, setVariant] = useState<VariantKey>('consolidated');

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center gap-1 px-4 py-1.5 border-b border-primary/10 bg-secondary/20">
        <span className="typo-caption font-mono uppercase tracking-widest text-foreground mr-2">Prototype</span>
        {VARIANTS.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => setVariant(v.key)}
            className={`px-2.5 py-1 typo-caption rounded-interactive transition-colors focus-ring ${
              variant === v.key
                ? 'bg-primary/15 text-primary border border-primary/30'
                : 'text-foreground hover:bg-primary/[0.06] border border-transparent'
            }`}
            title={v.sub}
          >
            {v.label}
          </button>
        ))}
      </div>
      {variant === 'consolidated' ? <MissionControlConsolidated /> : <DashboardHomeMissionControl />}
    </div>
  );
}
