/**
 * The step screen's BAND: the step as one compact object (~130px at 1920), in
 * the verdict's own stroke and wash. Left, the step: its key (the very key
 * pressed on the rail, flown here by a shared layout id), its name and verdict,
 * why, and the meta line. Right, its instrument: the hero figure on its dial
 * and the satellites. For Gate and Tests the step's own history sits between
 * them (under both when the band is narrow): the band's time axis.
 *
 * The band honours the time cursor: viewing a past Measure, a tracked step's
 * band shows THAT Measure's verdict, reason and metrics, carries the history
 * glyph by its name and a ring like the history's playhead, and its meta line
 * becomes the travel lead with the way back, as Layer 1's cards and status
 * band do. Nothing on the screen then disagrees with the band.
 */
import { forwardRef } from 'react';
import { History } from 'lucide-react';

import { stepGlyph, stepLabel } from '../../../journey/journeyLabels';
import type { JourneyNode } from '../../../journey/journeyModel';
import { useLifecycleViewModel } from '../../context';
import { HistoryStrip } from '../../history/HistoryStrip';
import { stepChange } from '../../layer1/delta';
import { VERDICT } from '../../layer1/healthModel';
import { healthLabel, reasonLine } from '../../layer1/layer1Labels';
import { BAND, RHYTHM, lcSurface } from '../../system/lcSurface';
import { LT } from '../../system/lcType';
import { VerdictPill } from '../../system/Pill';
import { GLYPH } from '../../system/scales';
import { KeyCap, useSharedKeyId } from '../../TactileKeys';
import { HISTORY_STEPS } from '../stepChunks';
import type { ShownStep } from '../useShownStep';
import { BandInstrument } from './BandInstrument';
import { BandMeta } from './BandMeta';

const TRAVEL_RING = 'ring-2 ring-primary/55 ring-offset-2 ring-offset-background';

export const StepBand = forwardRef<HTMLHeadingElement, { node: JourneyNode; shown: ShownStep }>(function StepBand({ node, shown }, titleRef) {
  const { dl, tx } = useLifecycleViewModel();
  const { step, travel } = shown;
  const was = step.health === 'stale' ? null : stepChange(step)?.was ?? null;
  const v = VERDICT[step.health];
  const label = stepLabel(dl, node.id, node.label);
  const Glyph = stepGlyph(node.id);
  const keyId = useSharedKeyId(node.id);
  const reason = reasonLine(dl, step.health, step.reason);
  const outline = step.health === 'instructed' ? 'border-2 border-solid border-primary/15' : v.outline;
  const tracked = HISTORY_STEPS.has(node.id);
  return (
    <header
      className={`@container/band transition-shadow duration-200 motion-reduce:transition-none ${lcSurface('band', `${outline} ${v.wash}`)} ${travel === 'then' ? TRAVEL_RING : ''}`}
      data-testid="lc2-header"
      data-health={step.health}
      data-travel={travel ?? undefined}
    >
      <div className={tracked ? BAND.grid : BAND.plain}>
        <div className={`flex items-center gap-4 ${BAND.identity}`}>
          <KeyCap state={node.strongestState} pressed size="lg" layoutId={keyId}>
            <Glyph className={`${GLYPH.lg} ${v.ink}`} aria-hidden />
          </KeyCap>
          <div className={`min-w-0 flex-1 ${RHYTHM.tight}`}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 ref={titleRef} tabIndex={-1} className={`${LT.pageTitle} outline-none`} data-testid="lc2-title">{label}</h2>
              <VerdictPill health={step.health} size="lg" />
              {was && <span className={LT.meta} data-was={was} data-testid="lc2-band-was">{tx(dl.lcx2_was, { verdict: healthLabel(dl, was) })}</span>}
              {travel === 'then' && <History className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden data-then />}
            </div>
            {reason && <p className={`line-clamp-2 ${LT.lead}`} data-testid="lc2-reason">{reason}</p>}
            <BandMeta step={step} travel={travel} />
          </div>
        </div>
        {tracked && (
          <div className={BAND.history}>
            <HistoryStrip stepId={node.id} />
          </div>
        )}
        <div className={tracked ? BAND.instrument : BAND.plainInstrument}>
          <BandInstrument step={step} />
        </div>
      </div>
    </header>
  );
});
