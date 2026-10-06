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
import { Keycap } from './parts';

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
    <div className="flex flex-col gap-2" data-testid="p2-reason">
      <span className="typo-heading text-foreground">{prompt.title}</span>
      {prompt.options.map((o, i) => (
        <Button key={o.id} variant="ghost" size="sm" block onClick={() => onSubmit(o.value)} className="au-branch au-lift justify-start! rounded-input py-2! hover:bg-transparent [&>span]:flex [&>span]:w-full [&>span]:items-center [&>span]:gap-2">
          <span className="min-w-0 flex-1 text-left typo-body text-foreground">{o.label}</span>
          <Keycap>{i + 1}</Keycap>
        </Button>
      ))}
      {prompt.freeText && (
        <textarea
          id="p2-reason-text"
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
          className="au-well w-full resize-none rounded-input px-3 py-2 typo-body text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      )}
      {min > 0 && (
        <span className={`typo-caption ${short ? 'text-status-warning' : 'text-status-success'}`}>
          {short ? `${min - text.trim().length} more characters needed` : 'Ready — ↵ sends it back'}
        </span>
      )}
      <div className="flex items-center gap-1.5 typo-caption">
        {min === 0 && <><Keycap>↵</Keycap> {prompt.skipLabel.toLowerCase()}</>}
        <span className="ml-auto flex items-center gap-1.5"><Keycap>Esc</Keycap> cancel</span>
      </div>
    </div>
  );
}
