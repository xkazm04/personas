// TODO(prototype, 2026-10-04): consolidate the Activity switcher — THROWAWAY.
// A/B strip over the Activity surface: the baseline plus the design-language
// variants, all receiving FleetGridView's exact props. Deleted at consolidation.
//
// DEFERRED DECISION, 2026-10-04. The owner stopped the round with three tabs
// live and said they would fuse the variants another day, so this switcher
// outlives the session deliberately rather than by neglect. Where it stands:
//
//   Baseline        production, untouched
//   E · Annunciator the 2026-09-24 contest winner, untouched
//   Plate           the layered surface — workspace cases -> project plates ->
//                   the real GridBoard for one project, decisions docked, the
//                   queue as `PlateLanes` (`layers/`)
//
// Two open questions Plate is NOT waiting on a design answer for, both recorded
// so the next session does not rediscover them:
//
//  1. Two of the card's three follow-up sigils are dead on real data. Reviews
//     and messages are summed from `PersonaCardModel.reviewCount` /
//     `.messageCount`, which measured ZERO across all 91 projects, while the
//     rail's unified queue held 68 reviews / 200 dispatch / 4 messages. The
//     counts the operator actually has are not attributed to a persona card, so
//     sourcing them per project from the rail is a real change, not a tweak.
//  2. The sigil doors (warning -> the failing persona's drawer; reviews /
//     messages -> the scoped dock) are wired and typecheck, but were never
//     confirmed end to end: the test-automation bridge cannot observe the
//     Monitor drawer opening even on the BASELINE variant, so the method is
//     blind rather than the code being wrong. Verify by hand.

import { useState, type ComponentType } from 'react';
import { silentCatch } from '@/lib/silentCatch';
import { Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { ActivitySurfaceProps } from './useActivitySurface';
import { ActivityEntryE } from './entry-e/ActivityEntryE';
import { ActivityCases } from './layers/ActivityCases';

type Pick = 'baseline' | 'entry-e' | 'plate';

const PICKS: readonly Pick[] = ['baseline', 'entry-e', 'plate'];

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
  { id: 'plate', label: 'Plate', hint: 'Layered: workspace cases, project plates, lanes, docked decisions' },
];

export function ActivityPrototypeSwitcher({
  Baseline, ...props
}: ActivitySurfaceProps & { Baseline: ComponentType<ActivitySurfaceProps> }) {
  const [pick, setPick] = useState<Pick>(read);
  const choose = (p: Pick) => {
    setPick(p);
    try { localStorage.setItem(KEY, p); } catch (err) { silentCatch('fleet/prototype:writeVariant')(err); }
  };

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
        {pick === 'plate' ? <ActivityCases {...props} />
          : pick === 'entry-e' ? <ActivityEntryE {...props} />
          : <Baseline {...props} />}
      </div>
    </div>
  );
}
