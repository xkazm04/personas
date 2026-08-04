import { useState } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FormField } from '@/features/shared/components/forms/FormField';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

const MAX_TITLE_LENGTH = 120;

interface DailyGoalsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Resolves true when the set was created (modal closes itself then). */
  onCreate: (titles: string[]) => Promise<boolean>;
}

/**
 * Entry form for a fresh daily-goal set: up to 3 goals, at least one
 * required. Evaluation stays manual in the bar; this modal only authors
 * the set.
 */
export function DailyGoalsModal({ isOpen, onClose, onCreate }: DailyGoalsModalProps) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const [titles, setTitles] = useState<[string, string, string]>(['', '', '']);
  const [submitting, setSubmitting] = useState(false);

  const nonEmpty = titles.map((s) => s.trim()).filter((s) => s.length > 0);

  const submit = async () => {
    if (nonEmpty.length === 0 || submitting) return;
    setSubmitting(true);
    const created = await onCreate(nonEmpty);
    setSubmitting(false);
    if (created) {
      setTitles(['', '', '']);
      onClose();
    }
  };

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId="daily-goals-modal-title" size="sm" portal>
      <div className="p-6 space-y-4">
        <h2 id="daily-goals-modal-title" className="typo-heading-lg text-foreground">
          {c.daily_goals_modal_title}
        </h2>
        <p className="typo-caption text-foreground/70">{c.daily_goals_modal_hint}</p>

        {titles.map((value, i) => (
          <FormField
            key={i}
            label={`${c.daily_goals_label} ${i + 1}`}
            required={i === 0}
            value={value}
            maxLength={MAX_TITLE_LENGTH}
          >
            {(inputProps) => (
              <input
                {...inputProps}
                type="text"
                value={value}
                maxLength={MAX_TITLE_LENGTH}
                placeholder={c.daily_goals_goal_placeholder}
                data-testid={`daily-goals-input-${i}`}
                className={INPUT_FIELD}
                onChange={(e) => {
                  const next = [...titles] as [string, string, string];
                  next[i] = e.target.value;
                  setTitles(next);
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
            disabled={nonEmpty.length === 0}
            loading={submitting}
            data-testid="daily-goals-create"
          >
            {c.daily_goals_create}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
