/**
 * Build-question fields: one batch, submitted by Accept. Choices are pills,
 * text fields offer the model's suggestions as one-tap chips. The control is
 * picked from a table keyed by the declared field kind, so a new kind in
 * `TriageQuestionField` fails to compile here instead of falling into a last arm.
 */
import type { ReactElement } from 'react';
import { PillGroup } from '@/features/shared/components/forms/PillGroup';
import { Button } from '@/features/shared/components/buttons';
import type { TriageQuestionField } from '@/features/agents/quick-answer/triage/triageTypes';

interface ControlProps {
  field: TriageQuestionField;
  value: string;
  onAnswer: (value: string) => void;
}

function ChoiceControl({ field, value, onAnswer }: ControlProps) {
  return (
    <PillGroup
      options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
      value={value}
      onChange={onAnswer}
      layoutId={`p1-q-${field.key}`}
      labelClass="typo-label"
      aria-label={field.prompt}
    />
  );
}

function TextControl({ field, value, onAnswer }: ControlProps) {
  return (
    <div className="space-y-1.5">
      <input
        id={`p1-q-${field.key}`}
        value={value}
        onChange={(e) => onAnswer(e.target.value)}
        placeholder={field.placeholder}
        className="p1-field typo-body"
      />
      {field.suggestions && field.suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {field.suggestions.map((s) => (
            <Button key={s} variant="secondary" size="xs" onClick={() => onAnswer(s)}>{s}</Button>
          ))}
        </div>
      )}
    </div>
  );
}

const CONTROL: Record<TriageQuestionField['kind'], (p: ControlProps) => ReactElement> = {
  choice: ChoiceControl,
  text: TextControl,
};

export function QuestionFields({ fields, answers, onAnswer }: {
  fields: TriageQuestionField[];
  answers: Record<string, string>;
  onAnswer: (key: string, value: string) => void;
}) {
  return (
    <div className="space-y-4">
      {fields.map((f, i) => {
        const Control = CONTROL[f.kind];
        return (
          <div key={f.key} className="space-y-1.5">
            <label htmlFor={`p1-q-${f.key}`} className="flex items-baseline gap-2">
              <span className="typo-data tabular-nums text-primary">{i + 1}.</span>
              <span className="typo-body text-foreground">{f.prompt}</span>
            </label>
            <Control field={f} value={answers[f.key] ?? ''} onAnswer={(v) => onAnswer(f.key, v)} />
          </div>
        );
      })}
    </div>
  );
}
