import { useState } from 'react';
import { ArenaPanelColosseum } from './ArenaPanelColosseum';
import { ArenaPanelLedger } from './ArenaPanelLedger';
import { ArenaPanelConstellation } from './ArenaPanelConstellation';

// --- Prototype tab switcher (throwaway scaffold) ---------------------
// Directional variants of the Arena surface. Baseline was retired once
// Colosseum + Ledger proved superior; Constellation now contests
// Colosseum's centrepiece with a celestial orrery treatment.

type ArenaVariant = 'colosseum' | 'constellation' | 'ledger';

const VARIANT_TABS: Array<{ id: ArenaVariant; label: string; subtitle: string }> = [
  { id: 'colosseum',     label: 'Colosseum',     subtitle: 'Heraldic gladiator ring' },
  { id: 'constellation', label: 'Constellation', subtitle: 'Celestial orrery — models on cost orbits' },
  { id: 'ledger',        label: 'Ledger',        subtitle: 'Quiet data-dense instrument' },
];

export function ArenaPanel() {
  const [variant, setVariant] = useState<ArenaVariant>('colosseum');
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 pb-2 border-b border-primary/10">
        {VARIANT_TABS.map((tab) => {
          const active = variant === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setVariant(tab.id)}
              className={`flex flex-col items-start gap-0.5 px-3 py-2 rounded-modal transition-colors border ${
                active
                  ? 'bg-primary/10 text-foreground border-primary/20'
                  : 'text-foreground/80 hover:bg-secondary/30 border-transparent'
              }`}
            >
              <span className="typo-body-lg font-medium">{tab.label}</span>
              <span className="typo-caption text-foreground/60">{tab.subtitle}</span>
            </button>
          );
        })}
      </div>
      {variant === 'colosseum'     && <ArenaPanelColosseum />}
      {variant === 'constellation' && <ArenaPanelConstellation />}
      {variant === 'ledger'        && <ArenaPanelLedger />}
    </div>
  );
}
