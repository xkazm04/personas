import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ResponsibilityCadence } from '@/lib/bindings/ResponsibilityCadence';
import type { ResponsibilityOutcome } from '@/lib/bindings/ResponsibilityOutcome';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { sameValue } from '../../libs/charterSpec';
import { OutcomesEditor } from '../fields/OutcomeObjectiveEditors';
import { RespCadenceFields } from '../fields/CadenceFields';
import { DimEditorShell, type CharterDimEditorProps } from './dimEditorShell';

/**
 * `task` — the charter's operating procedure and the outcomes it exists to
 * produce. This is the dimension the runtime prompt renders as the focused
 * charter, so it is the one editor that always has something to edit.
 */
export function TaskDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const [procedure, setProcedure] = useState(charter.procedure);
  const [outcomes, setOutcomes] = useState<ResponsibilityOutcome[]>(() =>
    charter.outcomes.map((o) => ({ ...o, successCriteria: [...o.successCriteria] })),
  );
  const dirty = procedure !== charter.procedure || !sameValue(outcomes, charter.outcomes);

  return (
    <DimEditorShell
      caption={c.dim_task_caption}
      dirty={dirty}
      testId="resp-dim-task"
      onSave={() => onPatch({ procedure, outcomes })}
    >
      <label className="flex flex-col gap-1.5">
        <span className="typo-title">{c.procedure_label}</span>
        <textarea
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          rows={5}
          placeholder={c.procedure_placeholder}
          className={`${INPUT_FIELD} resize-y`}
          data-testid="resp-dim-task-procedure"
        />
      </label>
      <OutcomesEditor outcomes={outcomes} onChange={setOutcomes} />
    </DimEditorShell>
  );
}

/**
 * `trigger` — the charter's cadence (the attention loop's master switch,
 * tempo, quiet hours and daily cap) plus the monthly budget that bounds it.
 */
export function TriggerDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const [cadence, setCadence] = useState<ResponsibilityCadence>(() => ({ ...charter.cadence }));
  const [budget, setBudget] = useState<number | undefined>(charter.budgetMonthlyUsd);
  const dirty = !sameValue(cadence, charter.cadence) || budget !== charter.budgetMonthlyUsd;

  return (
    <DimEditorShell
      caption={c.dim_trigger_caption}
      dirty={dirty}
      testId="resp-dim-trigger"
      onSave={() => onPatch({ cadence, budgetMonthlyUsd: budget ?? null })}
    >
      <RespCadenceFields
        cadence={cadence}
        budgetMonthlyUsd={budget}
        tenure={charter.tenure}
        onCadence={setCadence}
        onBudget={setBudget}
      />
    </DimEditorShell>
  );
}
