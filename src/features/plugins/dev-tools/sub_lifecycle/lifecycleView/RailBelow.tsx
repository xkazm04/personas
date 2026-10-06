/**
 * RAIL BELOW - the Lifecycle body, and the only one: the journey is a horizontal
 * two-lane rail read left to right, and the selected step's state is docked in a
 * reserved region directly beneath it. Nothing moves when you pick a node; the
 * page reads top-down, journey then state then evidence.
 *
 * Two prototype rounds tried to find an alternative and the owner closed both.
 * The first varied this by SKIN - "to change colors of borders or background is
 * not prototyping nor component redesign" - and the second built three rival
 * containers, which he also declined. Both mechanisms are deleted: there is no
 * skin registry, no concept registry and no picker, every value the kept skin
 * held is an ordinary class at the site that draws it, and the two props that
 * existed only so a rival container could stack this one (`StateLegend layout`,
 * `StepState columns`) are collapsed to the single branch that ships.
 *
 * The reserved region's min-height is held whether or not a step is selected, so
 * the state panel is never a block that appears and shoves the rail
 * (overview-loading law 6: a region is retired by its OWN data).
 *
 * The weakest-step sentence - the single most important line on the page, and the
 * reason the model pre-seeds the selection - rendered as `typo-body
 * text-foreground`, exactly the legend footnote two rows below it, with no trace
 * of the severity the model had already computed. It reads one type step up and
 * carries the weakest step's own status ink.
 */
import { useState } from 'react';

import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';

import { JourneyGhost } from '../journey/JourneyGhost';
import { STATE_TEXT } from '../journey/journeyStyles';
import { useLifecycleViewModel } from './context';
import { EvidenceLedger } from './blocks/EvidenceLedger';
import { LifecycleActions } from './blocks/LifecycleActions';
import { StateLegend } from './blocks/StateLegend';
import { StepRail } from './blocks/StepRail';
import { StepState } from './blocks/StepState';
import { RailBelowVariant1 } from './RailBelowVariant1';
import { RailBelowVariant2 } from './RailBelowVariant2';
import { RailBelowVariant3 } from './RailBelowVariant3';

function RailBelowBaseline() {
  const { headline, headlineState, order, loading } = useLifecycleViewModel();
  const ink = headlineState ? STATE_TEXT[headlineState] : 'text-foreground';

  return (
    <div className="space-y-5 pb-6" data-testid="lc-journey">
      <LifecycleActions />

      <div className="text-center">
        <p className={`typo-body-lg ${ink}`} data-testid="lc-weakest">{headline}</p>
      </div>

      {order.length > 0 ? <StepRail /> : loading ? <JourneyGhost /> : null}

      <StateLegend />

      <div className="min-h-[26rem] border-t border-primary/15 pt-5 space-y-4" data-testid="lc-state-region">
        <StepState />
        <div className="h-[17rem]">
          <EvidenceLedger />
        </div>
      </div>
    </div>
  );
}

// TODO(prototype, 2026-10-06): consolidate RailBelow switcher
// Throwaway prototype switcher: the same arrangement and data in four component
// languages, baseline by default. Session state only; the operator picks one and
// the switcher, the losers and `variantShared`/`VariantLedger` go with it.
type RailVariant = 'baseline' | 'instrument' | 'editorial' | 'tactile';

const RAIL_VARIANTS: { id: RailVariant; label: string }[] = [
  { id: 'baseline', label: 'Baseline' },
  { id: 'instrument', label: '1 Instrument' },
  { id: 'editorial', label: '2 Editorial' },
  { id: 'tactile', label: '3 Tactile' },
];

export function RailBelow() {
  const [variant, setVariant] = useState<RailVariant>('baseline');
  return (
    <div className="space-y-4">
      <div className="mx-auto w-fit">
        <SegmentedTabs
          tabs={RAIL_VARIANTS}
          activeTab={variant}
          onTabChange={setVariant}
          ariaLabel="RailBelow prototype variant"
          idPrefix="lc-proto"
          fullWidth={false}
          size="sm"
        />
      </div>
      <div role="tabpanel" id={`lc-proto-panel-${variant}`} aria-labelledby={`lc-proto-tab-${variant}`}>
        {variant === 'baseline' && <RailBelowBaseline />}
        {variant === 'instrument' && <RailBelowVariant1 />}
        {variant === 'editorial' && <RailBelowVariant2 />}
        {variant === 'tactile' && <RailBelowVariant3 />}
      </div>
    </div>
  );
}
