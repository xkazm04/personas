// TODO(prototype, 2026-09-24): consolidate the Activity switcher — THROWAWAY.
// A/B strip over the Activity surface: the baseline plus three design-language
// variants, all receiving FleetGridView's exact props. Deleted at consolidation.

import { useState, type ComponentType } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ActivitySurfaceProps } from './useActivitySurface';
import { ActivityEntryE } from './entry-e/ActivityEntryE';
import { ActivityAtlas } from './layers/ActivityAtlas';
import { ActivityCases } from './layers/ActivityCases';

type Pick = 'baseline' | 'entry-e' | 'atlas' | 'cases';

const PICKS: readonly Pick[] = ['baseline', 'entry-e', 'atlas', 'cases'];

const KEY = 'personas.prototype.activity-variant';
function read(): Pick {
  try {
    const v = localStorage.getItem(KEY);
    if ((PICKS as readonly string[]).includes(v ?? '')) return v as Pick;
  } catch (err) { silentCatch('fleet/prototype:readVariant')(err); }
  return 'baseline';
}

const TABS: Array<{ id: Pick; label: string; hint: string }> = [
  { id: 'baseline', label: 'Baseline', hint: 'Current production surface' },
  { id: 'entry-e', label: 'E · Annunciator', hint: 'Contest winner, with the owner adjustments' },
  { id: 'atlas', label: 'Atlas', hint: 'Layered: projects as a ranked ledger, every figure a door' },
  { id: 'cases', label: 'Cases', hint: 'Layered: projects as places, decisions docked and widening' },
];

export function ActivityPrototypeSwitcher({
  Baseline, ...props
}: ActivitySurfaceProps & { Baseline: ComponentType<ActivitySurfaceProps> }) {
  const [pick, setPick] = useState<Pick>(read);
  const choose = (p: Pick) => {
    setPick(p);
    try { localStorage.setItem(KEY, p); } catch (err) { silentCatch('fleet/prototype:writeVariant')(err); }
  };
  const Body = pick === 'entry-e' ? ActivityEntryE
    : pick === 'atlas' ? ActivityAtlas
    : pick === 'cases' ? ActivityCases
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
