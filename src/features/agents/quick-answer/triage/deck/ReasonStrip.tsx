// ReasonStrip — "why?", asked without stopping the deck.
//
// Every rejection this app has ever recorded wrote NULL for its reason, even
// though the columns, the write paths and the whole learning loop behind them
// were already in place (a rejected idea's reason becomes a `constraint` memory
// that stops future scans re-raising it). The missing piece was only ever the
// asking.
//
// Which makes the design constraint sharp: the ask must not cost the surface its
// speed. Three rules, all of them a refusal:
//
//  1. NOT a modal. It takes over the action bar — the strip lives exactly where
//     the verdict buttons were, so the eye does not move and nothing is
//     obscured. `BaseModal` would have been less work and would have made every
//     rejection a two-step dialogue.
//  2. NOT a required field. The rightmost control is the skip, and Esc or Enter
//     fires it. Skipping costs ONE keystroke, which is the same cost rejection
//     had before this existed.
//  3. NOT a form. Presets are digit keys, in the deck's own idiom (arrows
//     decide, numbers pick), so the common case is a single keypress and never a
//     round-trip to the mouse.
//
// The free-text box is a text input rather than a textarea on purpose: a reason
// is a phrase. Enter inside it submits what has been typed, so a reviewer who
// starts typing never has to reach for a button either.
import { useEffect, useRef } from 'react';
import { CornerDownLeft, MessageSquareOff } from 'lucide-react';

import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageReasonPrompt } from '../triageTypes';
import { Kbd, TONE_CHIP, TONE_HOVER } from './DeckChips';

export function ReasonStrip({
  prompt,
  draft,
  onDraft,
  onResolve,
}: {
  prompt: TriageReasonPrompt;
  draft: string;
  onDraft: (value: string) => void;
  /** No argument = skipped. The decision lands either way. */
  onResolve: (reason?: string) => void;
}) {
  const { t } = useTranslation();
  const skipRef = useRef<HTMLButtonElement | null>(null);

  // Move focus off whatever was clicked and onto the escape hatch. Two things
  // depend on it: the global digit/Enter handler only runs outside a field, and
  // a reviewer who reaches for Tab lands on "skip" rather than on the first
  // preset — the strip should always be one keystroke from getting out of the way.
  useEffect(() => {
    skipRef.current?.focus();
  }, [prompt]);

  return (
    <footer
      className="shrink-0 border-t border-status-error/25 bg-status-error/5 px-4 py-3"
      role="group"
      aria-label={t.monitor.triage_reason_aria}
    >
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="typo-label uppercase tracking-wide text-status-error">{prompt.title}</span>

        {prompt.options.map((option, i) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onResolve(option.value)}
            aria-label={option.label}
            title={option.label}
            className={`focus-ring inline-flex max-w-[18rem] items-center gap-2 rounded-interactive border px-3 py-2 typo-body transition-colors ${TONE_CHIP.neutral} ${TONE_HOVER.neutral}`}
          >
            <Kbd>{String(i + 1)}</Kbd>
            <span className="truncate">{option.label}</span>
          </button>
        ))}

        {prompt.freeText ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              e.preventDefault();
              // An empty box is a skip, not a blocked submit.
              onResolve(draft.trim() || undefined);
            }}
            placeholder={prompt.placeholder}
            aria-label={prompt.placeholder ?? prompt.title}
            className={`${INPUT_FIELD} w-64 max-w-full`}
          />
        ) : null}

        <button
          ref={skipRef}
          type="button"
          onClick={() => onResolve()}
          aria-label={prompt.skipLabel}
          title={prompt.skipLabel}
          className={`focus-ring inline-flex items-center gap-2 rounded-interactive border px-3 py-2 typo-body font-medium transition-colors ${TONE_CHIP.danger} ${TONE_HOVER.danger}`}
        >
          <MessageSquareOff className="h-4 w-4 shrink-0" aria-hidden />
          {prompt.skipLabel}
        </button>
      </div>

      <p className="mt-2.5 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 typo-caption">
        <span className="inline-flex items-center gap-1.5">
          <Kbd>1</Kbd>
          {prompt.options.length > 1 ? <Kbd>{String(prompt.options.length)}</Kbd> : null}
          {t.monitor.triage_reason_pick}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Kbd>
            <CornerDownLeft className="h-3 w-3" aria-hidden />
          </Kbd>
          <Kbd>Esc</Kbd>
          {prompt.skipLabel}
        </span>
      </p>
    </footer>
  );
}
