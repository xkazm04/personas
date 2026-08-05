import { useEffect, useState } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FormField } from '@/features/shared/components/forms/FormField';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import type { DailyGoal } from '@/api/companion';

const MAX_TITLE_LENGTH = 120;
const SLOTS = [0, 1, 2] as const;

/** One row of the form: an existing goal being rewritten, or a free slot. */
export interface GoalDraft {
  id: string | null;
  title: string;
}

const EMPTY_DRAFTS: GoalDraft[] = SLOTS.map(() => ({ id: null, title: '' }));

/** Prefill the three slots from the active set, padding with free slots. */
export function draftsFromGoals(goals: DailyGoal[]): GoalDraft[] {
  return SLOTS.map((i) => {
    const g = goals[i];
    return g ? { id: g.id, title: g.title } : { id: null, title: '' };
  });
}

interface DailyGoalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * The active set. Empty = create mode (author a new set); non-empty =
   * edit mode (rewrite the texts, fill a free slot to add a goal).
   */
  goals: DailyGoal[];
  /** Create mode. Resolves true when the set was created. */
  onCreate: (titles: string[]) => Promise<boolean>;
  /** Edit mode. Resolves true when the edits saved. */
  onSave: (drafts: GoalDraft[]) => Promise<boolean>;
}

/**
 * Authoring surface for daily goals, in two modes off the same form.
 *
 * Create: three empty slots, at least one required. Edit: the same three
 * slots prefilled with the active set, which is also how you READ a goal
 * in full — the bar's chips ellipsize to stay one line, so the textarea
 * here is where the whole text lives. Filling a free slot in edit mode
 * appends a goal; clearing one is refused (marking done or discarding
 * the set are the ways out, so a set can never silently lose its last
 * open goal).
 */
export function DailyGoalsModal({
  isOpen,
  onClose,
  goals,
  onCreate,
  onSave,
}: DailyGoalsModalProps) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const editing = goals.length > 0;
  const [drafts, setDrafts] = useState<GoalDraft[]>(EMPTY_DRAFTS);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed whenever the modal opens (or the set changes underneath it)
  // so a reopen never shows a stale draft.
  useEffect(() => {
    if (isOpen) setDrafts(editing ? draftsFromGoals(goals) : EMPTY_DRAFTS);
  }, [isOpen, editing, goals]);

  const filled = drafts.filter((d) => d.title.trim().length > 0);
  // Edit mode must keep every existing goal non-empty; create mode just
  // needs one line of text.
  const canSubmit = editing
    ? drafts.every((d) => !d.id || d.title.trim().length > 0)
    : filled.length > 0;

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    const ok = editing
      ? await onSave(drafts.map((d) => ({ id: d.id, title: d.title.trim() })))
      : await onCreate(filled.map((d) => d.title.trim()));
    setSubmitting(false);
    if (ok) {
      setDrafts(EMPTY_DRAFTS);
      onClose();
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="daily-goals-modal-title" size="sm" portal>
      <div className="p-6 space-y-4">
        <h2 id="daily-goals-modal-title" className="typo-heading-lg text-foreground">
          {editing ? c.daily_goals_edit_title : c.daily_goals_modal_title}
        </h2>
        <p className="typo-caption text-foreground">
          {editing ? c.daily_goals_edit_hint : c.daily_goals_modal_hint}
        </p>

        {drafts.map((draft, i) => (
          <FormField
            key={draft.id ?? `slot-${i}`}
            label={`${c.daily_goals_label} ${i + 1}`}
            required={!editing && i === 0}
            value={draft.title}
            maxLength={MAX_TITLE_LENGTH}
          >
            {(inputProps) => (
              // Textarea, not input: a goal can run to 120 chars and the
              // point of this form is reading it in full, not scrolling it.
              <textarea
                {...inputProps}
                rows={2}
                value={draft.title}
                maxLength={MAX_TITLE_LENGTH}
                placeholder={c.daily_goals_goal_placeholder}
                data-testid={`daily-goals-input-${i}`}
                className={`${INPUT_FIELD} resize-y min-h-16`}
                onChange={(e) => {
                  const next = drafts.slice();
                  next[i] = { ...next[i]!, title: e.target.value };
                  setDrafts(next);
                }}
              />
            )}
          </FormField>
        ))}

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            {t.common.cancel}
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            disabled={!canSubmit}
            loading={submitting}
            data-testid={editing ? 'daily-goals-save' : 'daily-goals-create'}
          >
            {editing ? t.common.save : c.daily_goals_create}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
