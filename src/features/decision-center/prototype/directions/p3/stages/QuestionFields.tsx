/** Answer fields for `question` items: choices as pressable options, text with suggestions. */
import { Button } from '@/features/shared/components/buttons';
import type { TriageQuestionField } from '@/features/agents/quick-answer/triage/triageTypes';

interface Props {
  fields: TriageQuestionField[];
  answers: Record<string, string>;
  onAnswer: (key: string, value: string) => void;
}

interface ControlProps { field: TriageQuestionField; value: string | undefined; onAnswer: Props['onAnswer'] }

function ChoiceControl({ field, value, onAnswer }: ControlProps) {
  return (
    <div id={`p3-q-${field.key}`} className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={field.prompt}>
      {(field.options ?? []).map((o) => (
        <Button key={o} size="sm" role="radio" aria-checked={value === o}
          variant={value === o ? 'accent' : 'secondary'} tone={value === o ? 'highlight' : undefined}
          onClick={() => onAnswer(field.key, o)}>
          {o}
        </Button>
      ))}
    </div>
  );
}

function TextControl({ field, value, onAnswer }: ControlProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <input
        id={`p3-q-${field.key}`}
        value={value ?? ''}
        onChange={(e) => onAnswer(field.key, e.target.value)}
        placeholder={field.placeholder ?? 'Type an answer'}
        className="typo-body w-48 rounded-input border border-border bg-background px-3 py-1.5 text-foreground"
      />
      {(field.suggestions ?? []).map((s) => (
        <Button key={s} size="xs" variant="ghost" onClick={() => onAnswer(field.key, s)}>{s}</Button>
      ))}
    </div>
  );
}

/** Exhaustive over the declared field kinds: a new kind fails to compile here, never falls through. */
function controlFor(props: ControlProps) {
  switch (props.field.kind) {
    case 'choice': return <ChoiceControl {...props} />;
    case 'text': return <TextControl {...props} />;
    default: {
      const unknownKind: never = props.field.kind;
      return unknownKind;
    }
  }
}

export function QuestionFields({ fields, answers, onAnswer }: Props) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1.5">
          <label htmlFor={`p3-q-${f.key}`} className="typo-body text-foreground">{f.prompt}</label>
          {controlFor({ field: f, value: answers[f.key], onAnswer })}
        </div>
      ))}
    </div>
  );
}
