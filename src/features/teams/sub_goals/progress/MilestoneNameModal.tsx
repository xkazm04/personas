/**
 * The one dialog the canvas needs: a milestone's name - and, when it is a
 * DEADLINE, its date.
 *
 * A context menu cannot ask a question, and a milestone without a name is not a
 * milestone - the Ship tab renders the name as the cut's heading. So creating
 * one from a row costs one field, plus one opt-in: the deadline checkbox. A
 * deadline is the one kind whose date is part of what it IS, so it is decided
 * here and the date is required once the box is ticked. Everything else about
 * the cut - cutting, bucketing, shipping - stays in the Ship tab.
 *
 * Interior comes from `ModalShell` (the modal interior standard), so this file
 * passes content and never a panel class string, and its field labels use
 * `MODAL_SECTION_HEAD` rather than a hand-composed tracked-uppercase string.
 *
 * `portal` is load-bearing: the canvas that opens this sits inside transformed,
 * clipped containers, and a `position: fixed` overlay under a transformed
 * ancestor is positioned against THAT ancestor, not the viewport - which drew
 * the dialog inside the section, clipped and unreadable. Portalled to the body
 * it is an app-level modal like every other.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Flag, Hourglass } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { MODAL_SECTION_HEAD, ModalShell } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

/** Today as the `YYYY-MM-DD` a date input speaks, in local time. */
function todayIso(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function MilestoneNameModal({
  isOpen,
  projectName,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  /** Which project the cut will belong to - a milestone is per repository. */
  projectName: string;
  onCancel: () => void;
  /** `deadline` is the chosen day when the deadline box is ticked, else `null`. */
  onConfirm: (name: string, deadline: string | null) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const fieldId = useId();
  const deadlineId = useId();
  const dateId = useId();
  const dateHintId = useId();
  const [name, setName] = useState('');
  const [isDeadline, setIsDeadline] = useState(false);
  const [date, setDate] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-opening is a fresh question: the previous answer was either committed or
  // abandoned, and pre-filling it would invite a duplicate cut by accident.
  useEffect(() => {
    if (isOpen) {
      setName('');
      setIsDeadline(false);
      setDate('');
      // Focus after BaseModal has mounted and taken focus to the panel.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isOpen]);

  const ready = name.trim().length > 0 && (!isDeadline || date.length > 0);
  const commit = () => {
    if (ready) onConfirm(name.trim(), isDeadline ? date : null);
  };
  const tone = STATUS_PALETTE.warning;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      titleId={titleId}
      width="sm"
      portal
      icon={isDeadline ? <Hourglass className="w-4 h-4" /> : <Flag className="w-4 h-4" />}
      title={t.athena.ship_milestone_confirm}
      subtitle={projectName}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t.athena.ship_milestone_cancel}
          </Button>
          <Button variant="primary" size="sm" disabled={!ready} onClick={commit}>
            {t.athena.ship_milestone_confirm}
          </Button>
        </div>
      }
    >
      <div className="space-y-2">
        <label htmlFor={fieldId} className={MODAL_SECTION_HEAD}>
          {t.athena.ship_milestone_name_label}
        </label>
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          className={INPUT_FIELD}
          value={name}
          maxLength={80}
          placeholder={t.athena.ship_milestone_name_placeholder}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
        />
      </div>

      <div
        className={`rounded-card border px-4 py-3 space-y-3 transition-colors ${
          isDeadline ? `${tone.border} ${tone.bg}` : 'border-primary/10 bg-background/60'
        }`}
      >
        <label htmlFor={deadlineId} className="flex items-start gap-3 cursor-pointer">
          <input
            id={deadlineId}
            type="checkbox"
            className="mt-0.5 w-4 h-4 shrink-0 accent-primary cursor-pointer"
            checked={isDeadline}
            onChange={(e) => setIsDeadline(e.target.checked)}
            data-testid="milestone-deadline-toggle"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 typo-heading text-foreground">
              <Hourglass className={`w-3.5 h-3.5 shrink-0 ${tone.text}`} aria-hidden />
              {t.athena.ship_milestone_deadline_toggle}
            </span>
            <span className="block typo-caption text-foreground mt-0.5">
              {t.athena.ship_milestone_deadline_hint}
            </span>
          </span>
        </label>

        {isDeadline && (
          <div className="space-y-2">
            <label htmlFor={dateId} className={MODAL_SECTION_HEAD}>
              {t.athena.ship_milestone_deadline_date_label}
            </label>
            <input
              id={dateId}
              type="date"
              required
              aria-required="true"
              aria-invalid={date.length === 0}
              aria-describedby={date.length === 0 ? dateHintId : undefined}
              className={INPUT_FIELD}
              value={date}
              min={todayIso()}
              onChange={(e) => setDate(e.target.value)}
              data-testid="milestone-deadline-date"
            />
            {date.length === 0 && (
              <p id={dateHintId} className={`typo-caption ${tone.text}`}>
                {t.athena.ship_milestone_deadline_date_required}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="typo-caption text-foreground">{t.athena.ship_milestone_planned_note}</p>
    </ModalShell>
  );
}
