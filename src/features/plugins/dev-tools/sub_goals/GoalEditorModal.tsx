/**
 * GoalEditorModal — create / edit / delete a dev goal.
 *
 * Closes the authoring gap: before this, goals could only be born from a
 * GitHub-issue import. Title is required; status + target date are optional.
 * Status option labels resolve through the shared `goal_state` token map so
 * they stay consistent with the Board lanes and Pulse view.
 */
import { useEffect, useState } from 'react';
import { Target, X, Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';

const STATUS_OPTIONS = ['open', 'in-progress', 'blocked', 'done'] as const;

interface Props {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  /** When set, the modal edits this goal; otherwise it creates a new one. */
  editGoal?: DevGoal | null;
}

export function GoalEditorModal({ isOpen, onClose, projectId, editGoal }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const isEdit = !!editGoal;

  const createGoal = useSystemStore((s) => s.createGoal);
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const deleteGoal = useSystemStore((s) => s.deleteGoal);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('open');
  const [targetDate, setTargetDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset/prefill whenever the modal opens or the edit target changes.
  useEffect(() => {
    if (!isOpen) return;
    setTitle(editGoal?.title ?? '');
    setDescription(editGoal?.description ?? '');
    setStatus(editGoal?.status ?? 'open');
    setTargetDate(editGoal?.target_date ? editGoal.target_date.slice(0, 10) : '');
    setConfirmDelete(false);
  }, [isOpen, editGoal]);

  const handleClose = () => {
    setConfirmDelete(false);
    onClose();
  };

  const handleSubmit = async () => {
    if (!title.trim() || saving) return;
    setSaving(true);
    try {
      const targetIso = targetDate ? new Date(targetDate).toISOString() : undefined;
      if (isEdit && editGoal) {
        await updateGoal(editGoal.id, {
          title: title.trim(),
          description: description.trim() || undefined,
          status,
          targetDate: targetIso,
        });
      } else {
        const goal = await createGoal(projectId, title.trim(), description.trim() || undefined, undefined, targetIso);
        // createGoal defaults status to 'open'; apply a non-default pick.
        if (status !== 'open') {
          await updateGoal(goal.id, { status });
        }
      }
      handleClose();
    } catch (err) {
      toastCatch(isEdit ? 'Failed to update goal' : 'Failed to create goal')(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editGoal) return;
    setSaving(true);
    try {
      await deleteGoal(editGoal.id);
      handleClose();
    } catch (err) {
      toastCatch('Failed to delete goal')(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={handleClose}
      titleId="goal-editor-title"
      maxWidthClass="max-w-lg"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-6 shadow-elevation-4 max-h-[88vh] overflow-y-auto"
    >
      <div className="flex items-start justify-between mb-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-interactive bg-violet-500/10 border border-violet-500/25 flex items-center justify-center shrink-0">
            <Target className="w-4 h-4 text-violet-400" />
          </div>
          <h2 id="goal-editor-title" className="typo-heading-lg font-semibold text-foreground">
            {isEdit ? dl.goal_edit_title : dl.goal_new_title}
          </h2>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={handleClose}>
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="space-y-4">
        {/* Title */}
        <div>
          <label htmlFor="goal-title" className="typo-caption font-medium text-foreground mb-1.5 block">
            {dl.goal_field_title}
          </label>
          <input
            id="goal-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={dl.goal_field_title_placeholder}
            autoFocus
            className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring"
          />
        </div>

        {/* Description */}
        <div>
          <label htmlFor="goal-description" className="typo-caption font-medium text-foreground mb-1.5 block">
            {dl.goal_field_description}
          </label>
          <textarea
            id="goal-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={dl.goal_field_description_placeholder}
            rows={3}
            className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground focus-ring resize-none"
          />
        </div>

        {/* Status + target date */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">{dl.goal_field_status}</label>
            <ThemedSelect value={status} onValueChange={setStatus}>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {tokenLabel(t, 'goal_state', s)}
                </option>
              ))}
            </ThemedSelect>
          </div>
          <div>
            <label htmlFor="goal-target" className="typo-caption font-medium text-foreground mb-1.5 block">
              {dl.goal_field_target_date}
            </label>
            <input
              id="goal-target"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="w-full px-3 py-2.5 text-md bg-secondary/40 border border-primary/10 rounded-input text-foreground focus-ring"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 mt-6 pt-4 border-t border-primary/10">
        {/* Delete (edit mode only) with inline confirm */}
        <div>
          {isEdit && (
            confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="typo-caption text-foreground">{dl.goal_delete_confirm}</span>
                <Button variant="accent" accentColor="rose" size="sm" disabled={saving} onClick={handleDelete}>
                  {t.common.delete}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{t.common.cancel}</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" icon={<Trash2 className="w-3.5 h-3.5" />} onClick={() => setConfirmDelete(true)}>
                {t.common.delete}
              </Button>
            )
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={handleClose}>{t.common.cancel}</Button>
          <Button
            variant="accent"
            accentColor="violet"
            size="sm"
            icon={isEdit ? <Pencil className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            disabled={!title.trim() || saving}
            onClick={handleSubmit}
          >
            {isEdit ? t.common.save : dl.goal_new_title}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
