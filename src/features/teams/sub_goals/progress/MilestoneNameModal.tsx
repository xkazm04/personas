/**
 * The one dialog the canvas needs: a milestone's name.
 *
 * A context menu cannot ask a question, and a milestone without a name is not a
 * milestone - the Ship tab renders the name as the cut's heading. So creating
 * one from a row costs exactly one field, and nothing else about the cut is
 * decided here: it is created `planned`, and cutting, dating, bucketing and
 * shipping stay in the Ship tab where the evidence for them lives.
 *
 * Interior comes from `ModalShell` (the modal interior standard), so this file
 * passes content and never a panel class string, and its one field label uses
 * `MODAL_SECTION_HEAD` rather than a hand-composed tracked-uppercase string.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { Flag } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { MODAL_SECTION_HEAD, ModalShell } from '@/features/shared/components/modals';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

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
  onConfirm: (name: string) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const fieldId = useId();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Re-opening is a fresh question: the previous answer was either committed or
  // abandoned, and pre-filling it would invite a duplicate cut by accident.
  useEffect(() => {
    if (isOpen) {
      setName('');
      // Focus after BaseModal has mounted and taken focus to the panel.
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return undefined;
  }, [isOpen]);

  const ready = name.trim().length > 0;
  const commit = () => {
    if (ready) onConfirm(name.trim());
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onCancel}
      titleId={titleId}
      width="sm"
      icon={<Flag className="w-4 h-4" />}
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
        <p className="typo-caption text-foreground">{t.athena.ship_milestone_planned_note}</p>
      </div>
    </ModalShell>
  );
}
