// TODO(prototype, 2026-09-24): consolidate the Activity switcher — THROWAWAY.
// A/B strip over the Activity surface: the baseline plus three design-language
// variants, all receiving FleetGridView's exact props. Deleted at consolidation.

import { useState, type ComponentType } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ActivitySurfaceProps } from './useActivitySurface';
import { ActivityInstrument } from './instrument/ActivityInstrument';
import { ActivityEntryD } from './entry-d/ActivityEntryD';
import { ActivityEntryE } from './entry-e/ActivityEntryE';

type Pick = 'baseline' | 'instrument' | 'entry-d' | 'entry-e';

const KEY = 'personas.prototype.activity-variant';
function read(): Pick {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'baseline' || v === 'instrument' || v === 'entry-d' || v === 'entry-e') return v;
  } catch (err) { silentCatch('fleet/prototype:readVariant')(err); }
  return 'baseline';
}

const TABS: Array<{ id: Pick; label: string; hint: string }> = [
  { id: 'baseline', label: 'Baseline', hint: 'Current production surface' },
  { id: 'instrument', label: 'A · Instrument', hint: 'Avionics HUD: luminous spines, mono data, gauges' },
  { id: 'entry-d', label: 'D', hint: 'Contest entry D' },
  { id: 'entry-e', label: 'E', hint: 'Contest entry E' },
];

export function ActivityPrototypeSwitcher({
  Baseline, ...props
}: ActivitySurfaceProps & { Baseline: ComponentType<ActivitySurfaceProps> }) {
  const [pick, setPick] = useState<Pick>(read);
  const choose = (p: Pick) => {
    setPick(p);
    try { localStorage.setItem(KEY, p); } catch (err) { silentCatch('fleet/prototype:writeVariant')(err); }
  };
  const Body = pick === 'instrument' ? ActivityInstrument
    : pick === 'entry-d' ? ActivityEntryD
      : pick === 'entry-e' ? ActivityEntryE
        : Baseline;
  return (
    <div className="flex h-full min-h-0 flex-col gap-1.5">
      <div className="flex flex-shrink-0 items-center gap-1 self-start rounded-interactive border border-dashed border-primary/30 bg-background/80 p-0.5" role="group" aria-label="Prototype variants">
        {TABS.map((tab) => (
          <Tooltip key={tab.id} content={tab.hint}>
            <Button
              variant="ghost"
              size="xs"
              onClick={() => choose(tab.id)}
              aria-pressed={pick === tab.id}
              data-testid={`activity-proto-${tab.id}`}
              className={`rounded-interactive px-2.5 py-0.5 ${pick === tab.id ? 'bg-primary/20 text-primary' : ''}`}
            >
              <span className="typo-label">{tab.label}</span>
            </Button>
          </Tooltip>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        <Body {...props} />
      </div>
    </div>
  );
}
