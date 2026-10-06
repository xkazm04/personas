/**
 * "Why?" — answerable with ONE key (a digit picks an option) and skippable
 * with ONE key (Enter, when nothing is typed), per the triage contract. A
 * prompt with no options (council send-back) focuses its text field at once
 * and will not submit under `min` characters.
 *
 * Digits are read by the deck's keyboard handler while the field is not
 * focused; here the field handles its own Enter / Esc.
 */
import { useState } from 'react';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import { Button } from '@/features/shared/components/buttons';
import { Kbd } from '@/features/shared/triage/triageFocusBridge';

export function ReasonPrompt({ prompt, min, onSubmit, onCancel }: {
  prompt: TriageReasonPrompt;
  min: number;
  onSubmit: (reason?: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const short = min > 0 && text.trim().length < min;
  const submitText = () => {
    if (short) return;
    onSubmit(text.trim() || undefined);
  };

  return (
    <div className="flex flex-col gap-2" data-testid="r2b-reason">
      <span className="typo-eyebrow text-foreground">{prompt.title}</span>
      {prompt.options.map((o, i) => (
        <Button key={o.id} variant="ghost" size="md" onClick={() => onSubmit(o.value)} className="r2b-reason-opt">
          <span className="r2b-key">{<Kbd>{i + 1}</Kbd>}</span>
          <span className="min-w-0 flex-1 text-left">{o.label}</span>
        </Button>
      ))}
      {prompt.freeText && (
        <textarea
          id="r2b-reason-text"
          rows={2}
          autoFocus={prompt.options.length === 0}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitText(); }
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
          }}
          placeholder={prompt.placeholder ?? 'Or write a reason…'}
          aria-label={prompt.title}
          className="r2b-field typo-body"
        />
      )}
      {min > 0 && (
        <span className={`typo-caption ${short ? 'text-status-warning' : 'text-status-success'}`}>
          {short ? `${min - text.trim().length} more characters needed` : 'Ready — ↵ sends it back'}
        </span>
      )}
      <div className="r2b-key flex items-center gap-1.5 typo-caption">
        {min === 0 && <><Kbd>↵</Kbd> {prompt.skipLabel.toLowerCase()}</>}
        <span className="ml-auto flex items-center gap-1.5"><Kbd>Esc</Kbd> cancel</span>
      </div>
    </div>
  );
}
