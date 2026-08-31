import { Plus, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ResponsibilityObjective } from '@/lib/bindings/ResponsibilityObjective';
import type { ResponsibilityOutcome } from '@/lib/bindings/ResponsibilityOutcome';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

function AddRowButton({ onClick, testId }: { onClick: () => void; testId: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 typo-caption hover:text-primary transition-colors"
      data-testid={testId}
    >
      <Plus className="w-3.5 h-3.5" /> {t.common.add}
    </button>
  );
}

function RemoveRowButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="shrink-0 mt-2 text-foreground/85 hover:text-status-error transition-colors"
    >
      <X className="w-3.5 h-3.5" />
    </button>
  );
}

/** Outcomes with their acceptance bars (success criteria, one per line). */
export function OutcomesEditor({
  outcomes,
  onChange,
}: {
  outcomes: ResponsibilityOutcome[];
  onChange: (o: ResponsibilityOutcome[]) => void;
}) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const patchRow = (i: number, patch: Partial<ResponsibilityOutcome>) =>
    onChange(outcomes.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div data-testid="life-resp-outcomes">
      <p className="typo-title mb-1.5">{life.resp_outcomes_label}</p>
      <div className="space-y-2">
        {outcomes.map((o, i) => (
          <div key={o.id} className="flex gap-2">
            <div className="flex-1 min-w-0 space-y-1.5">
              <input
                value={o.statement}
                onChange={(e) => patchRow(i, { statement: e.target.value })}
                placeholder={life.resp_outcome_statement_placeholder}
                className={INPUT_FIELD}
                data-testid={`life-resp-outcome-statement-${i}`}
              />
              <textarea
                value={o.successCriteria.join('\n')}
                onChange={(e) =>
                  patchRow(i, { successCriteria: e.target.value.split('\n') })
                }
                rows={2}
                placeholder={life.resp_outcome_criteria_placeholder}
                className={`${INPUT_FIELD} resize-y min-h-[2rem]`}
                data-testid={`life-resp-outcome-criteria-${i}`}
              />
            </div>
            <RemoveRowButton label={t.common.delete} onClick={() => onChange(outcomes.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddRowButton
          testId="life-resp-outcome-add"
          onClick={() =>
            onChange([
              ...outcomes,
              { id: crypto.randomUUID(), statement: '', successCriteria: [] },
            ])
          }
        />
      </div>
    </div>
  );
}

/** Measurable objectives: label, target, unit (key derived from the label). */
export function ObjectivesEditor({
  objectives,
  onChange,
}: {
  objectives: ResponsibilityObjective[];
  onChange: (o: ResponsibilityObjective[]) => void;
}) {
  const { t } = useTranslation();
  const life = t.agents.life;
  const patchRow = (i: number, patch: Partial<ResponsibilityObjective>) =>
    onChange(objectives.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div data-testid="life-resp-objectives">
      <p className="typo-title mb-1.5">{life.resp_objectives_label}</p>
      <div className="space-y-2">
        {objectives.map((o, i) => (
          <div key={o.key || i} className="flex gap-2 items-start">
            <input
              value={o.label}
              onChange={(e) =>
                patchRow(i, {
                  label: e.target.value,
                  // Keep an existing key stable; derive one for a new row.
                  key: o.key || e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''),
                })
              }
              placeholder={life.resp_objective_label_placeholder}
              className={`${INPUT_FIELD} flex-1 min-w-0`}
              data-testid={`life-resp-objective-label-${i}`}
            />
            <div className="w-28 shrink-0">
              <NumberStepper
                value={o.target ?? null}
                onChange={(v) => patchRow(i, { target: v ?? undefined })}
                allowEmpty
                placeholder={life.resp_objective_target_placeholder}
              />
            </div>
            <input
              value={o.unit ?? ''}
              onChange={(e) => patchRow(i, { unit: e.target.value || undefined })}
              placeholder={life.resp_objective_unit_placeholder}
              className={`${INPUT_FIELD} w-20 shrink-0`}
              data-testid={`life-resp-objective-unit-${i}`}
            />
            <RemoveRowButton label={t.common.delete} onClick={() => onChange(objectives.filter((_, j) => j !== i))} />
          </div>
        ))}
        <AddRowButton
          testId="life-resp-objective-add"
          onClick={() => onChange([...objectives, { key: '', label: '' }])}
        />
      </div>
    </div>
  );
}
