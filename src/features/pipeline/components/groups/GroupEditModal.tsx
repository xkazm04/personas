import { useEffect, useState } from 'react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import type { PersonaGroup } from '@/lib/bindings/PersonaGroup';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

const GROUP_COLOR_PRESETS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
  '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
  '#6b7280',
];

interface GroupEditModalProps {
  open: boolean;
  /** When provided, the modal is in "edit" mode for this group. When null, it's "create" mode. */
  group: PersonaGroup | null;
  onClose: () => void;
}

export function GroupEditModal({ open, group, onClose }: GroupEditModalProps) {
  const { t } = useTranslation();
  const createGroup = usePipelineStore((s) => s.createGroup);
  const updateGroup = usePipelineStore((s) => s.updateGroup);

  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [description, setDescription] = useState('');
  const [sharedInstructions, setSharedInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setColor(group?.color ?? '#6366f1');
    setDescription(group?.description ?? '');
    setSharedInstructions(group?.sharedInstructions ?? '');
    setSubmitting(false);
  }, [open, group]);

  const isEditing = group !== null;
  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      if (isEditing) {
        await updateGroup(group.id, {
          name: name.trim(),
          color,
          description,
          sharedInstructions,
        });
      } else {
        const created = await createGroup({
          name: name.trim(),
          color,
          description: description.trim() || undefined,
        });
        if (created && sharedInstructions.trim().length > 0) {
          await updateGroup(created.id, { sharedInstructions });
        }
      }
      onClose();
    } catch (err) {
      silentCatch('features/pipeline/components/groups/GroupEditModal:submit')(err);
      setSubmitting(false);
    }
  };

  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="group-edit-title"
      size="md"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
    >
      <div className="px-5 pt-5 pb-3 border-b border-primary/10">
        <h2 id="group-edit-title" className="typo-heading font-semibold text-foreground/90">
          {isEditing ? t.pipeline.groups.edit_group : t.pipeline.groups.create_group}
        </h2>
      </div>
      <div className="px-5 py-4 space-y-4">
        {/* Name */}
        <div>
          <label className="block typo-label text-foreground/90 mb-1.5">
            {t.pipeline.groups.field_name}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t.pipeline.groups.field_name_placeholder}
            autoFocus
            className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40"
          />
        </div>

        {/* Color */}
        <div>
          <label className="block typo-label text-foreground/90 mb-1.5">
            {t.pipeline.groups.field_color}
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {GROUP_COLOR_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setColor(preset)}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  color.toLowerCase() === preset.toLowerCase()
                    ? 'border-foreground/90 scale-110'
                    : 'border-transparent hover:scale-105'
                }`}
                style={{ backgroundColor: preset }}
                aria-label={preset}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-7 h-7 rounded-input cursor-pointer bg-transparent border border-primary/15"
              aria-label={t.pipeline.groups.field_color_custom}
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block typo-label text-foreground/90 mb-1.5">
            {t.pipeline.groups.field_description}
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t.pipeline.groups.field_description_placeholder}
            rows={2}
            className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40 resize-none"
          />
        </div>

        {/* Shared instructions */}
        <div>
          <label className="block typo-label text-foreground/90 mb-1.5">
            {t.pipeline.groups.field_shared_instructions}
          </label>
          <p className="typo-label text-foreground mb-1.5">
            {t.pipeline.groups.field_shared_instructions_hint}
          </p>
          <textarea
            value={sharedInstructions}
            onChange={(e) => setSharedInstructions(e.target.value)}
            placeholder={t.pipeline.groups.field_shared_instructions_placeholder}
            rows={5}
            className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40 font-mono resize-y"
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-primary/10">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!canSubmit}>
            {isEditing ? t.common.save : t.pipeline.groups.create_group}
          </Button>
        </div>
      </div>
    </BaseModal>
  );
}
