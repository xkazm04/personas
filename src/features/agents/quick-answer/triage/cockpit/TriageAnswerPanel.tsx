/**
 * TriageAnswerPanel — the one item type that isn't a verdict.
 *
 * A build question doesn't want approval, it wants an ANSWER, and a persona is
 * halted until it gets one. So the input is not tucked into the decision rail
 * with the verdict buttons — it sits in the reading column directly under the
 * question, at the size of the thing it is answering.
 *
 * Three shapes, from the model:
 *  • deferred — a connector picker or file attach this surface genuinely can't
 *    honour. Show why, and point at the branch that CAN (digit `1`).
 *  • choice   — the options, selectable; Accept submits the selection.
 *  • text     — a field, with the model's own suggestions as one-tap chips.
 *
 * ⚠️ PROTOTYPE (/prototype round 1): English literals inline, `src/i18n/**` is
 * off-limits this round. See cockpitKinds.tsx for the full note.
 */
import type { RefObject } from 'react';
import { ExternalLink } from 'lucide-react';

import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { TriageInput } from '../triageTypes';
import { ShortcutChip } from './ShortcutChip';

export function TriageAnswerPanel({
  input,
  value,
  onChange,
  onSubmit,
  submitLabel,
  disabled,
  inputRef,
}: {
  input: TriageInput;
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  /** The item's own verb for accept — "Submit" on a question. */
  submitLabel: string;
  disabled: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  if (input.deferred) {
    return (
      <div className="max-w-[68ch] flex items-start gap-3 rounded-card border border-primary/15 bg-secondary/25 px-4 py-3.5">
        <ExternalLink className="w-4 h-4 mt-0.5 shrink-0 text-primary" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <span className="typo-body text-foreground">
            This answer needs a picker the cockpit can&apos;t host — a connector, a file or a
            webhook source.
          </span>
          <span className="typo-caption text-foreground inline-flex items-center gap-1.5">
            Open it in the persona builder with <ShortcutChip keys="1" /> or the button on the
            right.
          </span>
        </div>
      </div>
    );
  }

  if (input.kind === 'choice' && input.options?.length) {
    return (
      <div className="max-w-[68ch] flex flex-col gap-3">
        <div
          className="flex flex-col gap-2"
          role="radiogroup"
          aria-label="Answer options"
        >
          {input.options.map((option) => {
            const selected = value === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onChange(option)}
                onDoubleClick={onSubmit}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-card border transition-colors focus-ring disabled:is-disabled ${
                  selected
                    ? 'border-primary/45 bg-primary/12'
                    : 'border-primary/12 bg-secondary/25 hover:bg-secondary/50 hover:border-primary/25'
                }`}
              >
                <span
                  className={`w-3.5 h-3.5 shrink-0 rounded-full border-2 ${
                    selected ? 'border-primary bg-primary/60' : 'border-primary/30'
                  }`}
                  aria-hidden="true"
                />
                <span className="typo-body-lg text-foreground">{option}</span>
              </button>
            );
          })}
        </div>
        <span className="typo-caption text-foreground inline-flex items-center gap-1.5">
          Pick one, then <ShortcutChip keys="A" title={submitLabel} /> to {submitLabel.toLowerCase()}.
        </span>
      </div>
    );
  }

  return (
    <div className="max-w-[68ch] flex flex-col gap-3">
      {input.suggestions && input.suggestions.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="typo-label text-muted-foreground">Suggested answers</span>
          <div className="flex flex-wrap gap-1.5">
            {input.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={disabled}
                onClick={() => onChange(suggestion)}
                title={`Use this answer: ${suggestion}`}
                className={`px-2.5 py-1 rounded-pill border typo-caption transition-colors focus-ring disabled:is-disabled ${
                  value === suggestion
                    ? 'border-primary/45 bg-primary/12 text-primary'
                    : 'border-primary/15 bg-secondary/30 text-foreground hover:bg-secondary/55'
                }`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="text"
        value={value}
        disabled={disabled}
        aria-label="Your answer"
        placeholder={input.placeholder || 'Type your answer…'}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && value.trim()) {
            e.preventDefault();
            onSubmit();
          }
        }}
        className={`${INPUT_FIELD} typo-body-lg`}
      />
      <span className="typo-caption text-foreground inline-flex items-center gap-1.5">
        <ShortcutChip keys="Enter" title={submitLabel} /> or{' '}
        <ShortcutChip keys="A" title={submitLabel} /> to {submitLabel.toLowerCase()}. Letter
        shortcuts pause while you type.
      </span>
    </div>
  );
}
