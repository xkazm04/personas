// QuestionPanel — the answer-collecting half of the deck.
//
// A build question is the one item type that has no case to argue: the title IS
// the question, and "accept" means "here is the answer". Inside a swipe deck
// that is a hazard — a card you can fling away mid-sentence loses work — so the
// deck marks these cards undraggable and hands the body to this panel instead.
// The gesture vocabulary survives (→ still accepts), it just refuses to fire
// until there is something to submit.
//
// `deferred` questions (connector picker, file attach) get no input at all.
// Offering a text box for an answer the backend cannot accept is worse than
// offering nothing; the deep-link branch is the honest control.
import type { RefObject } from 'react';

import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { TriageItem } from '../triageTypes';
import { Kbd, TONE_CHIP, TONE_HOVER } from './DeckChips';

interface QuestionPanelProps {
  item: TriageItem;
  answer: string;
  onAnswer: (value: string) => void;
  /** Submit an explicit value — choice options bypass the draft entirely. */
  onSubmit: (value: string) => void;
  onBranch: (branchId: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function QuestionPanel({ item, answer, onAnswer, onSubmit, onBranch, textareaRef }: QuestionPanelProps) {
  const input = item.input;
  if (!input) return null;

  if (input.deferred) {
    return (
      <div className="space-y-3 rounded-card border border-status-warning/25 bg-status-warning/5 p-4">
        <p className="typo-body text-foreground">
          This one needs the full picker — it can&apos;t be answered from a card.
        </p>
        <div className="flex flex-wrap gap-2">
          {item.branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              onClick={() => onBranch(branch.id)}
              title={branch.hint}
              aria-label={branch.label}
              className={`focus-ring inline-flex items-center gap-2 rounded-interactive border px-3 py-1.5 typo-body font-medium transition-colors ${TONE_CHIP.accent} ${TONE_HOVER.accent}`}
            >
              {branch.icon ? <branch.icon className="h-4 w-4" aria-hidden /> : null}
              {branch.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (input.kind === 'choice' && input.options?.length) {
    return (
      <div className="space-y-2">
        <p className="typo-label text-primary">Pick one</p>
        {input.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => onSubmit(option)}
            title={option}
            aria-label={option}
            className={`focus-ring block w-full rounded-card border px-4 py-3 text-left typo-body text-foreground transition-colors ${TONE_CHIP.neutral} ${TONE_HOVER.accent}`}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {input.suggestions?.length ? (
        <div className="space-y-1.5">
          <p className="typo-label text-primary">Suggested</p>
          <div className="flex flex-wrap gap-1.5">
            {input.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  onAnswer(suggestion);
                  textareaRef.current?.focus();
                }}
                title={suggestion}
                aria-label={suggestion}
                className={`focus-ring max-w-full truncate rounded-pill border px-3 py-1 typo-caption transition-colors ${TONE_CHIP.accent} ${TONE_HOVER.accent}`}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        value={answer}
        onChange={(e) => onAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) {
            e.preventDefault();
            onSubmit(answer.trim());
          }
        }}
        rows={4}
        placeholder={input.placeholder}
        aria-label={item.title}
        className={`${INPUT_FIELD} resize-none`}
      />

      <p className="typo-caption flex items-center gap-1.5">
        <Kbd>Ctrl</Kbd>
        <Kbd>Enter</Kbd>
        {item.verdictLabels.accept}
      </p>
    </div>
  );
}
