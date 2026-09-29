/**
 * The interim Lifecycle journey view for one snapshot: the weakest-step line,
 * the two-lane track, a legend of the binding shapes, and the step detail
 * layer. Pure presentation over `journeyModel`; the page owns data + actions.
 *
 * TEMPORARY: the lifecycle-nextgen contest winner replaces this component.
 */
import { useMemo, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { JourneyTrack } from './JourneyTrack';
import { StepDetailSheet } from './StepDetailSheet';
import { buildLanes, weakest } from './journeyModel';
import { bindingStateLabel, bindingStatePhrase, stepLabel } from './journeyLabels';
import { LEGEND_STATES, STATE_CHIP } from './journeyStyles';

interface LifecycleJourneyProps {
  snapshot: LifecycleSnapshot;
  /** Show missing bindings as pending: an install was just dispatched and the refetch has not landed. */
  forcePending?: boolean;
}

export function LifecycleJourney({ snapshot, forcePending = false }: LifecycleJourneyProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const lanes = useMemo(() => buildLanes(snapshot, forcePending), [snapshot, forcePending]);
  const weak = useMemo(() => weakest(snapshot), [snapshot]);
  const [openId, setOpenId] = useState<string | null>(null);
  // Resolve against the live lanes so a refresh updates an open layer in place.
  const openNode = openId ? [...lanes.before, ...lanes.after].find((n) => n.id === openId) ?? null : null;

  const weakSentence = weak
    ? tx(weak.skipped > 0 ? dl.lc_weakest_with_skips : dl.lc_weakest_plain, {
        step: stepLabel(dl, weak.node.id, weak.node.label),
        state: bindingStatePhrase(dl, weak.node.strongestState),
        skipped: weak.skipped,
        total: weak.total,
      })
    : null;
  const line = snapshot.evidence.length === 0
    ? [dl.lc_no_evidence, weakSentence].filter(Boolean).join(' ')
    : weakSentence ?? dl.lc_all_strong;

  return (
    <div className="space-y-6" data-testid="lc-journey">
      <p className="typo-body text-foreground text-center" data-testid="lc-weakest">{line}</p>

      <JourneyTrack lanes={lanes} onOpen={(n) => setOpenId(n.id)} />

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2" data-testid="lc-legend">
        {LEGEND_STATES.map((s) => (
          <span key={s} className="flex items-center gap-1.5 typo-caption text-foreground">
            <span className={`w-3.5 h-3.5 rounded-interactive ${STATE_CHIP[s]}`} aria-hidden />
            {bindingStateLabel(dl, s)}
          </span>
        ))}
        <span className="typo-caption text-foreground">{dl.lc_legend_evidence}</span>
      </div>

      {openNode && (
        <StepDetailSheet node={openNode} evidence={snapshot.evidence} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
