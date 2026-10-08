/**
 * GENERIC preset (isolate, link, sync, commit, land, record and custom
 * `x-*` steps): the done rate with its n against the threshold (the step's
 * own, else the snapshot's rules; its ring is the step's instrument above),
 * the tally of recent changes as countable units, and the changes themselves.
 * An instructed step (frame, recall, custom) has nothing to measure and says
 * so on the sentence plate; its rule is in the section below.
 */
import { useMemo } from 'react';
import { Info } from 'lucide-react';

import { Section, UnitStrip } from '@/features/shared/components/kit';

import { outcomeLabel } from '../../journey/journeyLabels';
import type { JourneyNode } from '../../journey/journeyModel';
import { evidenceRowsFor } from '../blocks/evidenceRows';
import { useLifecycleViewModel } from '../context';
import { VERDICT, type HealthStep } from '../layer1/healthModel';
import { MetricValue, SampleNote } from '../layer1/parts/MetricValue';
import { OUTCOMES } from '../railShared';
import { Count } from '../system/Count';
import { RHYTHM, lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { thresholdsFor } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { EvidenceRows, OUTCOME_MARK } from './EvidenceRows';

function Tally({ node }: { node: JourneyNode }) {
  const { dl, tx } = useLifecycleViewModel();
  const t = node.tally;
  return (
    <div className={RHYTHM.tight} data-testid="lc2-tally">
      <UnitStrip
        size="l"
        label={tx(dl.lc_detail_tally, { ...t })}
        segments={OUTCOMES.map((o) => ({ n: t[o], tone: OUTCOME_MARK[o].tone, glyph: OUTCOME_MARK[o].glyph }))}
      />
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {OUTCOMES.map((o) => (
          <span key={o} className={`flex items-center gap-1.5 ${LT.row}`} data-tally={o}>
            <Count value={t[o]} />
            {outcomeLabel(dl, o)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function GenericPreset({ step, node }: { step: HealthStep; node: JourneyNode }) {
  const { dl, tx, evidence } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const rows = useMemo(() => evidenceRowsFor(node.id, evidence).filter((r) => r.outcome !== 'unknown' || r.detail), [node.id, evidence]);
  const done = step.metrics.find((m) => m.key === 'done_rate') ?? null;
  const { doneRatePct, amberFloorPct } = thresholdsFor(rules, node.view.step.params);

  return (
    <>
      {step.health === 'instructed' ? (
        <Section title={dl.lc2_measure_title} level={2}>
          <p className={`flex items-center gap-3 ${lcSurface('plate')} ${LT.lead}`} data-testid="lc2-instructed">
            <Info className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
            {dl.lc1_reason_instructed}
          </p>
        </Section>
      ) : (
        <Section title={dl.lc2_measure_title} level={2} desc={tx(dl.lc2_done_threshold, { green: doneRatePct, amber: amberFloorPct })}>
          <div className={`flex flex-wrap items-center ${RHYTHM.inlineWide}`}>
            {done && (
              <div className="flex flex-col gap-1" data-testid="lc2-done-rate">
                <span className={LT.label}>{dl.lc1_metric_done_rate}</span>
                <MetricValue metric={done} className={`${LT.stat} ${VERDICT[step.health].ink}`} />
                <SampleNote metric={done} />
              </div>
            )}
            <Tally node={node} />
          </div>
        </Section>
      )}
      <Section title={dl.lc_detail_evidence} level={2} count={rows.length || undefined}>
        <EvidenceRows rows={rows} empty={dl.lc_detail_no_evidence} testId="lc2-evidence" />
      </Section>
    </>
  );
}
