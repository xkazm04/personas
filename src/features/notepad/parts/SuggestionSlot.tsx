import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FilePlus2, HelpCircle, Pencil, Sparkles } from 'lucide-react';

import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import Button from '@/features/shared/components/buttons/Button';
import { MarkdownMiniEditor } from '@/features/shared/components/editors/MarkdownMiniEditor';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { resolveNoteSuggestion } from '@/api/notepad';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

import { markRowResolvedLocally } from '../athena/noteSuggestions';
import { refetchNote } from '../notepadStore';
import type { NoteSuggestion } from '../variants/types';

interface SuggestionSlotProps {
  suggestions: NoteSuggestion[];
  /** Only a DRAFT note accepts a body edit — the server refuses the rest. When
   *  this is true the accept/edit affordances are hidden rather than shown and
   *  then refused, because a button that cannot work is worse than no button. */
  readOnly?: boolean;
  className?: string;
  /** Hide the "no suggestions" line — for a margin rail where an empty state
   *  would be noise rather than information. */
  quietWhenEmpty?: boolean;
}

/** The glyph and label that tell the reader what a block IS before they read
 *  it. `question` is deliberately a different affordance, not a different
 *  colour: it writes nothing into the note. */
const KIND_META: Record<
  NoteSuggestion['kind'],
  { Icon: typeof Sparkles; labelKey: 'suggestion_kind_section' | 'suggestion_kind_edit' | 'suggestion_kind_question' }
> = {
  section: { Icon: FilePlus2, labelKey: 'suggestion_kind_section' },
  edit: { Icon: Pencil, labelKey: 'suggestion_kind_edit' },
  question: { Icon: HelpCircle, labelKey: 'suggestion_kind_question' },
};

/**
 * One inline suggestion, rendered where it would land.
 *
 * Each row is answered ON ITS OWN and there is no "accept all": applying eight
 * of somebody else's paragraphs into your own note in one click is not a
 * decision anyone makes, so offering it would be offering a button the operator
 * cannot honestly press.
 */
function SuggestionBlock({ row, readOnly }: { row: NoteSuggestion; readOnly: boolean }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const { Icon, labelKey } = KIND_META[row.kind];
  const label = t.notepad[labelKey];
  const [editing, setEditing] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');

  const resolve = async (outcome: 'accepted' | 'rejected' | 'edited', bodyMd?: string) => {
    try {
      const next = await resolveNoteSuggestion(row.cardId, row.rowId, outcome, bodyMd);
      // The card's config is what decides which rows are still open, so the
      // local copy is projected forward from the write that just succeeded —
      // that is what makes this block leave the note immediately.
      markRowResolvedLocally(row.cardId, row.rowId, outcome);
      void refetchNote(next.id);
      setEditing(null);
    } catch (e) {
      toastCatch('notepad resolve suggestion')(e);
    }
  };

  const answerHer = async () => {
    const text = answer.trim();
    if (!text) return;
    useCompanionStore.getState().setPendingChatPrompt({
      text: `About the note suggestion "${row.bodyMd}" — ${text}`,
      source: 'notepad',
    });
    await resolve('accepted');
  };

  return (
    <motion.div
      layout={reduceMotion ? false : 'position'}
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      // Accepting a row INSERTS its text into the note; the block leaving is
      // the confirmation that the insert happened, so it fades rather than
      // vanishing — and the blocks below it slide up instead of jumping.
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: reduceMotion ? 0 : 0.16, ease: 'easeOut' }}
      className="rounded-card border border-primary/15 bg-secondary/20 px-3 py-2.5 space-y-2"
      data-testid={`notepad-suggestion-${row.rowId}`}
    >
      <div className="flex items-center gap-1.5 typo-caption text-foreground/85">
        <Icon className="w-3 h-3 shrink-0" aria-hidden />
        <span>{label}</span>
        {row.title && <span className="text-foreground/85 truncate">· {row.title}</span>}
      </div>

      {editing === null ? (
        <MarkdownRenderer content={row.bodyMd} className="typo-caption text-foreground/85" />
      ) : (
        <MarkdownMiniEditor
          value={editing}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          rows={5}
          ariaLabel={t.notepad.suggestion_edit_label}
          testId={`notepad-suggestion-edit-${row.rowId}`}
          className="w-full resize-y rounded-input border border-primary/15 bg-background/60 px-2 py-1.5 typo-caption text-foreground/90 outline-none focus:border-primary/30"
        />
      )}

      {row.kind === 'question' ? (
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder={t.notepad.suggestion_answer_placeholder}
            aria-label={t.notepad.suggestion_answer_placeholder}
            data-testid={`notepad-suggestion-answer-${row.rowId}`}
            className="flex-1 min-w-0 rounded-input border border-primary/15 bg-background/60 px-2 py-1 typo-caption text-foreground placeholder:text-foreground/60 outline-none focus:border-primary/30"
          />
          <AsyncButton size="sm" variant="secondary" disabled={!answer.trim()} onClick={answerHer}>
            {t.notepad.suggestion_answer_send}
          </AsyncButton>
          <Button size="sm" variant="ghost" onClick={() => void resolve('rejected')}>
            {t.notepad.suggestion_reject}
          </Button>
        </div>
      ) : readOnly ? (
        <div className="flex items-center justify-between gap-2">
          <p className="typo-caption text-status-warning/80">{t.notepad.suggestion_readonly}</p>
          <Button size="sm" variant="ghost" onClick={() => void resolve('rejected')}>
            {t.notepad.suggestion_reject}
          </Button>
        </div>
      ) : editing === null ? (
        <div className="flex items-center gap-2">
          <AsyncButton size="sm" variant="primary" onClick={() => resolve('accepted')}>
            {t.notepad.suggestion_accept}
          </AsyncButton>
          <Button size="sm" variant="secondary" onClick={() => setEditing(row.bodyMd)}>
            {t.notepad.suggestion_edit}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void resolve('rejected')}>
            {t.notepad.suggestion_reject}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <AsyncButton
            size="sm"
            variant="primary"
            disabled={!editing.trim()}
            onClick={() => resolve('edited', editing)}
          >
            {t.notepad.suggestion_save}
          </AsyncButton>
          <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
            {t.notepad.suggestion_cancel}
          </Button>
        </div>
      )}
    </motion.div>
  );
}

/**
 * Where Athena's suggestions land.
 *
 * Every body variant reserves this space, so the rows appear at the reading
 * position the layout already chose for them — Journal's margin, Workbench's
 * rail, Split's preview column. That is the whole reason this is a slot rather
 * than a panel: a suggestion about a document is judged next to the document.
 */
export function SuggestionSlot({
  suggestions,
  readOnly = false,
  className,
  quietWhenEmpty,
}: SuggestionSlotProps) {
  const { t } = useTranslation();

  if (suggestions.length === 0) {
    if (quietWhenEmpty) return null;
    return (
      <div className={`typo-caption text-foreground/85 ${className ?? ''}`}>
        {t.notepad.suggestions_empty}
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-2 ${className ?? ''}`}>
      <div className="flex items-center gap-1.5 typo-caption text-foreground/85">
        <Sparkles className="w-3 h-3" aria-hidden />
        {t.notepad.suggestions_title}
      </div>
      <AnimatePresence initial={false}>
        {suggestions.map((row) => (
          <SuggestionBlock key={`${row.cardId}:${row.rowId}`} row={row} readOnly={readOnly} />
        ))}
      </AnimatePresence>
    </div>
  );
}
