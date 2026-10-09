/**
 * GENERIC preset (isolate, link, sync, commit, land, record and custom `x-*`
 * steps): the story of the practice told by its own record, top to bottom:
 *
 * - how it measures: the done rate now with its n and its move, and the rate
 *   over time against the target (`evidence/AdherenceSection`);
 * - why it was skipped: the notes of the misses, grouped and ranked, each one
 *   a question for Athena (`evidence/ReasonsSection`);
 * - by source: the outcomes per kind of change (`evidence/SourcesSection`);
 * - the changes themselves by day, filterable, each opening a drawer with
 *   what it did on every step (`evidence/ChangeTimeline`).
 *
 * The record is the step detail's (up to 200 changes) joined with the
 * snapshot's newest window, so the screen draws at once and fills in. An
 * instructed step (frame, recall) has nothing to measure and says so on its
 * calm plate; a custom `x-*` step is instructed too, and when changes record
 * it anyway the plate leads its record.
 */
import { Info } from 'lucide-react';

import { Section } from '@/features/shared/components/kit';

import type { JourneyNode } from '../../journey/journeyModel';
import { useLifecycleViewModel } from '../context';
import type { HealthStep } from '../layer1/healthModel';
import { lcSurface } from '../system/lcSurface';
import { LT } from '../system/lcType';
import { thresholdsFor } from '../system/rules';
import { GLYPH } from '../system/scales';
import { useSnapshotRules } from '../system/useSnapshotRules';
import { AdherenceSection } from './evidence/AdherenceSection';
import { ChangeTimeline } from './evidence/ChangeTimeline';
import { ReasonsSection } from './evidence/ReasonsSection';
import { SourcesSection } from './evidence/SourcesSection';
import { useStepEvidence } from './evidence/useStepEvidence';
import type { PresetData } from './presetData';

function InstructedNote({ custom }: { custom: boolean }) {
  const { dl } = useLifecycleViewModel();
  return (
    <p className={`flex items-center gap-3 ${lcSurface('plate')} ${LT.lead}`} data-testid="lc2-instructed">
      <Info className={`${GLYPH.md} shrink-0 text-primary`} aria-hidden />
      {custom ? dl.lcx8_custom_evidence : dl.lc1_reason_instructed}
    </p>
  );
}

export function GenericPreset({ step, node, data }: { step: HealthStep; node: JourneyNode; data?: PresetData }) {
  const { dl, projectId } = useLifecycleViewModel();
  const rules = useSnapshotRules();
  const ev = useStepEvidence(node.id, data);
  const thresholds = thresholdsFor(rules, node.view.step.params);
  const instructed = step.health === 'instructed';
  const custom = instructed && node.id.startsWith('x-') && ev.rows.length > 0;

  if (instructed && !custom) {
    return (
      <Section title={dl.lc2_measure_title} level={2}>
        <InstructedNote custom={false} />
      </Section>
    );
  }
  return (
    <>
      <AdherenceSection
        step={step}
        series={ev.series}
        thresholds={thresholds}
        stepKey={`${projectId}:${node.id}`}
        loading={ev.loading}
        lead={custom ? <InstructedNote custom /> : null}
      />
      <ReasonsSection reasons={ev.reasons} node={node} />
      <SourcesSection sources={ev.sources} />
      <ChangeTimeline rows={ev.rows} stepId={node.id} loading={ev.loading} />
    </>
  );
}
