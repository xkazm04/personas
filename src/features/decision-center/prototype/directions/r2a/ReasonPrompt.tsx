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
import { Key } from './Key';

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
    <div className="flex flex-col gap-2" data-testid="r2a-reason">
      <span className="typo-heading text-foreground">{prompt.title}</span>
      {prompt.options.map((o, i) => (
        <Button key={o.id} variant="ghost" size="md" block onClick={() => onSubmit(o.value)} className="r2a-verdict r2a-btn" data-look="plain">
          <span className="min-w-0 flex-1 text-left typo-body">{o.label}</span>
          <Key>{String(i + 1)}</Key>
        </Button>
      ))}
      {prompt.freeText && (
        <textarea
          id="r2a-reason-text"
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
          className="r2a-input w-full resize-none rounded-input px-2.5 py-1.5 typo-body text-foreground"
        />
      )}
      {min > 0 && (
        <span className={`typo-caption ${short ? 'text-status-warning' : 'text-status-success'}`}>
          {short ? `${min - text.trim().length} more characters needed` : 'Ready — ↵ sends it back'}
        </span>
      )}
      <div className="flex items-center gap-1.5 typo-caption">
        {min === 0 && <><Key>↵</Key> {prompt.skipLabel.toLowerCase()}</>}
        <span className="ml-auto flex items-center gap-1.5"><Key>Esc</Key> cancel</span>
      </div>
    </div>
  );
}
