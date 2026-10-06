/**
 * Input fields for a `question` card (a paused build asking for answers). All
 * fields submit as ONE batch on A — the triage contract's batching rule.
 *
 * The control is chosen by an EXHAUSTIVE switch over the declared
 * `TriageQuestionField['kind']` union, so a new field kind fails the build
 * here instead of falling silently into a text box.
 */
import { Button } from '@/features/shared/components/buttons';
import type { TriageInput, TriageQuestionField } from '@/features/agents/quick-answer/triage/triageTypes';

interface ControlProps {
  field: TriageQuestionField;
  value: string;
  onAnswer: (value: string) => void;
}

function ChoiceControl({ field, value, onAnswer }: ControlProps) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" id={`r2b-field-${field.key}`}>
      {(field.options ?? []).map((o) => (
        <Button key={o} variant={value === o ? 'accent' : 'secondary'} tone={value === o ? 'info' : undefined} size="sm" role="radio" aria-checked={value === o} onClick={() => onAnswer(o)}>
          {o}
        </Button>
      ))}
    </div>
  );
}

function TextControl({ field, value, onAnswer }: ControlProps) {
  return (
    <div className="flex flex-col gap-2">
      <input
        id={`r2b-field-${field.key}`}
        value={value}
        onChange={(e) => onAnswer(e.target.value)}
        placeholder={field.placeholder ?? 'Type an answer'}
        className="r2b-field max-w-sm typo-body"
      />
      {field.suggestions && field.suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="typo-caption">Suggested</span>
          {field.suggestions.map((s) => (
            <Button key={s} variant="secondary" size="xs" onClick={() => onAnswer(s)}>
              {s}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function controlFor(kind: TriageQuestionField['kind']) {
  switch (kind) {
    case 'choice':
      return ChoiceControl;
    case 'text':
      return TextControl;
    default: {
      const unhandled: never = kind;
      return unhandled;
    }
  }
}

export function QuestionFields({ input, answers, onAnswer, missing }: {
  input: TriageInput;
  answers: Record<string, string>;
  onAnswer: (key: string, value: string) => void;
  missing: boolean;
}) {
  return (
    <div className="flex flex-col gap-5" aria-label="Answers" role="group" data-testid="r2b-question-fields">
      {input.fields.map((field, i) => {
        const empty = missing && !answers[field.key]?.trim();
        const Control = controlFor(field.kind);
        return (
          <div key={field.key} className="flex flex-col gap-2">
            <label htmlFor={`r2b-field-${field.key}`} className={`flex items-baseline gap-2.5 typo-heading ${empty ? 'text-status-warning' : 'text-foreground'}`}>
              <span className="r2b-num typo-data r2b-unit">{String(i + 1).padStart(2, '0')}</span>
              {field.prompt}{empty ? ' — needed' : ''}
            </label>
            <Control field={field} value={answers[field.key] ?? ''} onAnswer={(v) => onAnswer(field.key, v)} />
          </div>
        );
      })}
    </div>
  );
}
