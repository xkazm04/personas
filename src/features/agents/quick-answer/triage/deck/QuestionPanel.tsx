// QuestionPanel — the answer-collecting half of the deck.
//
// A build session is the one item type that has no case to argue: the questions
// ARE the content, and "accept" means "here are the answers". Inside a swipe
// deck that is a hazard — a card you can fling away mid-sentence loses work —
// so the deck marks these cards undraggable and hands the body to this panel
// instead. The gesture vocabulary survives (→ still accepts), it just refuses
// to fire until there is something to submit.
//
// One panel covers the WHOLE session, however many questions it is waiting on,
// and accepting it is one batched write. Answering them one card at a time
// resumed the halted CLI once per answer.
//
// `deferred` fields (connector picker, file attach) get no input at all.
// Offering a text box for an answer the backend cannot accept is worse than
// offering nothing; the deep-link branch is the honest control. A session that
// mixes the two is still answerable here — the picker-only questions simply
// stay pending and come back as their own card.
import type { RefObject } from 'react';

import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { useTranslation } from '@/i18n/useTranslation';

import type { TriageItem, TriageQuestionField } from '../triageTypes';
import { Kbd, TONE_CHIP, TONE_HOVER } from './DeckChips';

interface QuestionPanelProps {
  item: TriageItem;
  /** Draft per field key. */
  answers: Record<string, string>;
  onAnswer: (fieldKey: string, value: string) => void;
  /** Submit the whole card. `extra` carries a value the control owns itself
   *  (a clicked option) so it cannot race the draft it just set. */
  onSubmit: (extra?: Record<string, string>) => void;
  onBranch: (branchId: string) => void;
  /** Focused when accept fires with nothing filled in. */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

/** The branch buttons for a card that needs the builder for some or all of it. */
function BuilderBranches({ item, onBranch }: { item: TriageItem; onBranch: (id: string) => void }) {
  return (
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
  );
}

function QuestionField({
  field,
  value,
  showPrompt,
  submitOnPick,
  onAnswer,
  onSubmit,
  inputRef,
}: {
  field: TriageQuestionField;
  value: string;
  /** A single-question card already carries the question as its title. */
  showPrompt: boolean;
  /**
   * Whether picking an option submits the card outright. True only when this
   * is the card's ONLY question — otherwise one tap would send the card while
   * the reviewer is still typing the answer to the next one.
   */
  submitOnPick: boolean;
  onAnswer: (value: string) => void;
  onSubmit: (extra?: Record<string, string>) => void;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();

  const prompt = showPrompt ? (
    <p className="typo-body font-medium text-foreground">{field.prompt}</p>
  ) : null;

  if (field.deferred) {
    return (
      <div className="space-y-1.5 rounded-card border border-status-warning/25 bg-status-warning/5 p-3">
        {showPrompt ? prompt : null}
        <p className="typo-caption text-foreground">{t.monitor.triage_field_builder_only}</p>
      </div>
    );
  }

  if (field.kind === 'choice' && field.options?.length) {
    return (
      <div className="space-y-2">
        {prompt ?? <p className="typo-label text-primary">{t.monitor.triage_pick_one}</p>}
        {field.options.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => {
              onAnswer(option);
              if (submitOnPick) onSubmit({ [field.key]: option });
            }}
            title={option}
            aria-label={option}
            aria-pressed={value === option}
            className={`focus-ring block w-full rounded-card border px-4 py-3 text-left typo-body text-foreground transition-colors ${
              value === option ? TONE_CHIP.accent : TONE_CHIP.neutral
            } ${TONE_HOVER.accent}`}
          >
            {option}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {prompt}
      {field.suggestions?.length ? (
        <div className="flex flex-wrap gap-1.5">
          {field.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => onAnswer(suggestion)}
              title={suggestion}
              aria-label={suggestion}
              className={`focus-ring max-w-full truncate rounded-pill border px-3 py-1 typo-caption transition-colors ${TONE_CHIP.accent} ${TONE_HOVER.accent}`}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}

      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onAnswer(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            onSubmit();
          }
        }}
        rows={field.suggestions?.length ? 2 : 3}
        placeholder={field.placeholder}
        aria-label={field.prompt}
        className={`${INPUT_FIELD} resize-none`}
      />
    </div>
  );
}

export function QuestionPanel({
  item,
  answers,
  onAnswer,
  onSubmit,
  onBranch,
  textareaRef,
}: QuestionPanelProps) {
  const { t } = useTranslation();
  const input = item.input;
  if (!input) return null;

  const fields = input.fields;
  const answerable = fields.filter((f) => !f.deferred);
  // With one question the card's title already IS the question; repeating it
  // above its own input reads as a stutter.
  const showPrompts = fields.length > 1;
  const firstAnswerable = answerable[0]?.key;

  if (input.deferred) {
    return (
      <div className="space-y-3 rounded-card border border-status-warning/25 bg-status-warning/5 p-4">
        <p className="typo-body text-foreground">{t.monitor.triage_deferred_note}</p>
        {showPrompts ? (
          <ul className="space-y-1">
            {fields.map((field) => (
              <li key={field.key} className="typo-caption text-foreground">
                {field.prompt}
              </li>
            ))}
          </ul>
        ) : null}
        <BuilderBranches item={item} onBranch={onBranch} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {answerable.length < fields.length ? (
        <p className="typo-caption rounded-card border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-foreground">
          {t.monitor.triage_deferred_some}
        </p>
      ) : null}

      {fields.map((field) => (
        <QuestionField
          key={field.key}
          field={field}
          value={answers[field.key] ?? ''}
          showPrompt={showPrompts}
          submitOnPick={fields.length === 1}
          onAnswer={(value) => onAnswer(field.key, value)}
          onSubmit={onSubmit}
          inputRef={field.key === firstAnswerable ? textareaRef : undefined}
        />
      ))}

      {answerable.some((f) => f.kind !== 'choice') ? (
        <p className="typo-caption flex items-center gap-1.5">
          <Kbd>Ctrl</Kbd>
          <Kbd>Enter</Kbd>
          {item.verdictLabels.accept}
        </p>
      ) : null}

      {item.branches.length > 0 ? <BuilderBranches item={item} onBranch={onBranch} /> : null}
    </div>
  );
}
