import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { StringListEditor } from '../fields/StringListEditor';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import {
  mergeSpec,
  sameValue,
  memoryPolicyEnabled,
  reviewPolicyMode,
  REVIEW_MODES,
} from '../../libs/charterSpec';
import { DimEditorShell, type CharterDimEditorProps } from './dimEditorShell';

/**
 * `review` — the human gate. Two coupled fields: `approvalGates` (actions that
 * ALWAYS need the operator, re-validated server-side) and `spec.reviewPolicy.
 * mode`, the queue behaviour carried over from the source use case / recipe.
 */
export function ReviewDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const savedMode = reviewPolicyMode(charter.spec);
  const [gates, setGates] = useState<string[]>(() => [...charter.approvalGates]);
  const [mode, setMode] = useState(savedMode);
  const dirty = mode !== savedMode || !sameValue(gates, charter.approvalGates);

  const modeLabels: Record<string, string> = {
    '': c.review_mode_unset,
    always: c.review_mode_always,
    auto_triage: c.review_mode_auto_triage,
    never: c.review_mode_never,
  };

  return (
    <DimEditorShell
      caption={c.dim_review_caption}
      dirty={dirty}
      testId="resp-dim-review"
      onSave={() =>
        onPatch({
          approvalGates: gates,
          spec: mergeSpec(charter.spec, { reviewPolicy: mode ? { mode } : undefined }),
        })
      }
    >
      <div className="flex flex-col gap-1.5">
        <span className="typo-title">{c.review_mode_label}</span>
        <ThemedSelect
          filterable
          hideSearch
          options={REVIEW_MODES.map((v) => ({ value: v, label: modeLabels[v] ?? v }))}
          value={mode}
          onValueChange={setMode}
          aria-label={c.review_mode_label}
        />
      </div>
      <div data-testid="resp-dim-review-gates">
        <StringListEditor
          label={c.approval_gates_label}
          items={gates}
          onChange={setGates}
          testId="resp-gate"
        />
      </div>
    </DimEditorShell>
  );
}

/** `memory` — whether runs of this charter write to the persona's memory lane. */
export function MemoryDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const saved = memoryPolicyEnabled(charter.spec);
  const [enabled, setEnabled] = useState(saved);

  return (
    <DimEditorShell
      caption={c.dim_memory_caption}
      dirty={enabled !== saved}
      testId="resp-dim-memory"
      onSave={() => onPatch({ spec: mergeSpec(charter.spec, { memoryPolicy: { enabled } }) })}
    >
      <AccessibleToggle
        checked={enabled}
        onChange={() => setEnabled((v) => !v)}
        label={c.memory_enabled_label}
        data-testid="resp-dim-memory-toggle"
      />
    </DimEditorShell>
  );
}

/**
 * `error` — where unrecovered failures go (`spec.errorPolicy`) plus the source's
 * free-prose guidance (`spec.errorHandling`). The prose is deliberately NOT
 * synthesized into the structured policy: 299/299 recipe seeds carry prose and
 * none carry a policy, and inferring booleans from prose is fabrication.
 */
export function ErrorDimEditor({ charter, onPatch }: CharterDimEditorProps) {
  const { t } = useTranslation();
  const c = t.agents.responsibilities;
  const saved = charter.spec.errorPolicy ?? {};
  const savedProse = charter.spec.errorHandling ?? '';
  const [incident, setIncident] = useState(saved.incident === true);
  const [lab, setLab] = useState(saved.lab === true);
  const [escalateAfter, setEscalateAfter] = useState<number | undefined>(saved.escalateAfter);
  const [prose, setProse] = useState(savedProse);
  const dirty =
    incident !== (saved.incident === true) ||
    lab !== (saved.lab === true) ||
    escalateAfter !== saved.escalateAfter ||
    prose !== savedProse;

  return (
    <DimEditorShell
      caption={c.dim_error_caption}
      dirty={dirty}
      testId="resp-dim-error"
      onSave={() =>
        onPatch({
          spec: mergeSpec(charter.spec, {
            errorPolicy: { incident, lab, escalateAfter },
            errorHandling: prose.trim() ? prose : undefined,
          }),
        })
      }
    >
      <AccessibleToggle
        checked={incident}
        onChange={() => setIncident((v) => !v)}
        label={c.error_incident_label}
        data-testid="resp-dim-error-incident"
      />
      <AccessibleToggle
        checked={lab}
        onChange={() => setLab((v) => !v)}
        label={c.error_lab_label}
        data-testid="resp-dim-error-lab"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="typo-title">{c.error_escalate_after_label}</span>
        <NumberStepper
          value={escalateAfter ?? null}
          onChange={(v) => setEscalateAfter(v != null && v > 0 ? v : undefined)}
          min={0}
          max={99}
          allowEmpty
          ariaLabel={c.error_escalate_after_label}
          data-testid="resp-dim-error-escalate"
        />
      </div>
      <label className="flex flex-col gap-1.5">
        <span className="typo-title">{c.error_handling_label}</span>
        <textarea
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          rows={3}
          placeholder={c.error_handling_placeholder}
          className={`${INPUT_FIELD} resize-y`}
          data-testid="resp-dim-error-prose"
        />
      </label>
    </DimEditorShell>
  );
}
