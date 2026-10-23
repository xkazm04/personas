/**
 * L2, one project: the same columns, each counting this project's last
 * changes at that step (oldest at the foot, the newest on top; an empty slot
 * when fewer than the window were read). A cell or the lit column opens that
 * step's detail, the last layer.
 *
 * The plane also holds what used to sit in Layer 1's status slot: a running
 * Measure's panel and the Overseer's goal. They take the plane's room, never
 * the header's.
 */
import { memo, useCallback, useId, useMemo } from 'react';

import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import type { LifecycleOutcome } from '@/lib/bindings/LifecycleOutcome';

import { useLifecycleViewModel } from '../../context';
import type { HealthStep } from '../../layer1/healthModel';
import { useProjectSteps, type ProjectSteps } from '../data/useProjectSteps';
import { MeasurePanel } from '../../measure/MeasurePanel';
import { useMeasureSession } from '../../measure/measureSession';
import { RelatedItemProvider } from '../../layer2/related/relatedItem';
import { cancelStepIntent, prefetchStepOnIntent } from '../../layer2/stepChunks';
import { GoalItems, GoalLine, useGoalFold } from '../../overseer/GoalPanel';
import { OverseerBadge } from '../../overseer/OverseerBadge';
import { columnName, healthLabel, laneName, outcomeWord, type Dl, type Tx } from '../model/lensWords';
import { Field, type FieldCell, type FieldColumn } from '../shell/Field';
import { FieldGhost } from '../shell/FieldGhost';

/** The change window a column draws: the snapshot's newest evidence, at most this many. */
export const WINDOW = 20;
const FOOT_TONE: Record<string, string> = { red: 'red', amber: 'amber', stale: 'stale', green: 'green' };

export function outcomeAt(e: LifecycleEvidenceItem, stepId: string): LifecycleOutcome {
  return e.outcomes.find((o) => o.stepId === stepId)?.outcome ?? 'unknown';
}

export function projectColumns(
  dl: Dl,
  tx: Tx,
  { steps, measuring, settled }: ProjectSteps,
  evidence: LifecycleEvidenceItem[],
  litStepId: string | null,
): FieldColumn[] {
  const window = evidence.slice(0, WINDOW).reverse();
  return steps.map((s) => {
    const name = columnName(dl, s.node);
    const cells: FieldCell[] = window.map((e) => {
      const outcome = outcomeAt(e, s.node.id);
      return {
        key: `${s.node.id}-${e.sourceRef}`,
        tone: outcome,
        pointer: { kind: 'change', stepId: s.node.id, ref: e.sourceRef },
        label: tx(dl.lens_commit_aria, { sha: e.sourceRef.slice(0, 10), outcome: outcomeWord(dl, outcome) }),
      };
    });
    for (let i = cells.length; i < WINDOW; i++) cells.push({ key: `${s.node.id}-empty-${i}`, tone: 'none', pointer: null, label: '' });
    const tally = measuring.get(s.node.id);
    const foot = tally
      ? (tally.total > 0 ? tx(dl.lcx4_card_measuring_count, { done: tally.done, total: tally.total }) : dl.lcx4_card_measuring)
      : healthLabel(dl, s.health);
    return {
      id: s.node.id,
      name,
      phase: s.node.phase,
      lit: s.node.id === litStepId,
      fault: s.health === 'red',
      foot: { text: foot, tone: tally ? 'quiet' : FOOT_TONE[s.health] ?? 'quiet' },
      measure: tally ? 'measuring' : settled.has(s.node.id) ? 'settled' : undefined,
      cells,
      label: tx(dl.lens_column_aria, { step: name, summary: foot }),
      badge: <OverseerBadge stepId={s.node.id} />,
    };
  });
}

function Goal({ steps }: { steps: HealthStep[] }) {
  const { refetch } = useLifecycleViewModel();
  return <RelatedItemProvider onDecided={refetch}><GoalBody steps={steps} /></RelatedItemProvider>;
}

function GoalBody({ steps }: { steps: HealthStep[] }) {
  const fold = useGoalFold();
  const headingId = useId();
  const bodyId = useId();
  return (
    <div className="flex-none pb-2" data-testid="lens-goal">
      <GoalLine steps={steps} fold={fold} headingId={headingId} bodyId={bodyId} />
      <GoalItems fold={fold} bodyId={bodyId} />
    </div>
  );
}

export const ProjectPlane = memo(function ProjectPlane({ litStepId, intro, onSelect }: {
  litStepId: string | null;
  intro: boolean;
  onSelect: (stepId: string) => void;
}) {
  const { dl, tx, projectId, snapshot, evidence, openStep, loading } = useLifecycleViewModel();
  // Opening a step should rarely wait: a rest on a column warms its screen, preset and detail.
  const intent = useMemo(() => ({ start: (id: string) => prefetchStepOnIntent(projectId, id), end: cancelStepIntent }), [projectId]);
  const { open: measureOpen } = useMeasureSession();
  const project = useProjectSteps();
  const columns = useMemo(() => projectColumns(dl, tx, project, evidence, litStepId), [dl, tx, project, evidence, litStepId]);
  const lanes = useMemo(() => ({ before: laneName(dl, 'before'), after: laneName(dl, 'after') }), [dl]);
  const open = useCallback((id: string) => openStep(id), [openStep]);
  if (!snapshot) return loading ? <FieldGhost dl={dl} /> : null;
  return (
    <>
      {measureOpen && <div className="flex-none pb-3" data-testid="lens-measure"><MeasurePanel /></div>}
      {snapshot?.goal && <Goal steps={project.steps} />}
      <Field
        columns={columns}
        intro={intro}
        label={dl.lens_field_aria}
        lanes={lanes}
        onSelect={onSelect}
        onOpenColumn={open}
        onOpenCell={open}
        intent={intent}
      />
    </>
  );
});
