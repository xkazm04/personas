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

/**
 * Choices for the group-level default model dropdown. Mirrors the canonical
 * `ANTHROPIC_MODELS` list in `@/lib/models/modelCatalog` — keep them in sync
 * if a new tier ever lands. We serialize as a JSON-encoded `ModelProfile`
 * (`{ model: "...", provider: "anthropic" }`) since that's the on-disk
 * shape `defaultModelProfile` carries.
 */
const GROUP_MODEL_CHOICES = [
  { id: '', labelKey: 'pipeline.groups.field_model_inherit' as const },
  { id: 'haiku', labelKey: 'pipeline.groups.field_model_haiku' as const },
  { id: 'sonnet', labelKey: 'pipeline.groups.field_model_sonnet' as const },
  { id: 'opus', labelKey: 'pipeline.groups.field_model_opus' as const },
];

/** Pull a model id out of a stored JSON `ModelProfile`, tolerating malformed/empty values. */
function parseStoredModel(json: string | null): string {
  if (!json) return '';
  try {
    const obj = JSON.parse(json) as { model?: unknown };
    return typeof obj?.model === 'string' ? obj.model : '';
  } catch {
    return '';
  }
}

function serializeModelProfile(modelId: string): string | undefined {
  if (!modelId) return undefined;
  return JSON.stringify({ model: modelId, provider: 'anthropic' });
}

function parseNumberInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

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
  const clearGroupDefaultsAction = usePipelineStore((s) => s.clearGroupDefaults);

  const [name, setName] = useState('');
  const [color, setColor] = useState('#6366f1');
  const [description, setDescription] = useState('');
  const [sharedInstructions, setSharedInstructions] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [defaultBudget, setDefaultBudget] = useState('');
  const [defaultTurns, setDefaultTurns] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name ?? '');
    setColor(group?.color ?? '#6366f1');
    setDescription(group?.description ?? '');
    setSharedInstructions(group?.sharedInstructions ?? '');
    setDefaultModel(parseStoredModel(group?.defaultModelProfile ?? null));
    setDefaultBudget(group?.defaultMaxBudgetUsd != null ? String(group.defaultMaxBudgetUsd) : '');
    setDefaultTurns(group?.defaultMaxTurns != null ? String(group.defaultMaxTurns) : '');
    setSubmitting(false);
  }, [open, group]);

  const isEditing = group !== null;
  const canSubmit = name.trim().length > 0 && !submitting;

  // Compose the defaults patch — only include fields where the user typed
  // a value, so save preserves prior values for blank-out vs. explicit clear.
  const buildDefaultsPatch = () => {
    const budget = parseNumberInput(defaultBudget);
    const turns = parseNumberInput(defaultTurns);
    const modelProfile = serializeModelProfile(defaultModel);
    return {
      // Empty string in the model select means "no group default" → clear.
      defaultModelProfile: defaultModel === '' ? '' : modelProfile,
      defaultMaxBudgetUsd: budget,
      defaultMaxTurns: turns != null ? Math.round(turns) : null,
    };
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const defaults = buildDefaultsPatch();
      if (isEditing) {
        await updateGroup(group.id, {
          name: name.trim(),
          color,
          description,
          sharedInstructions,
          ...(defaults.defaultModelProfile !== undefined && {
            defaultModelProfile: defaults.defaultModelProfile,
          }),
          ...(defaults.defaultMaxBudgetUsd !== undefined && {
            defaultMaxBudgetUsd: defaults.defaultMaxBudgetUsd ?? undefined,
          }),
          ...(defaults.defaultMaxTurns !== undefined && {
            defaultMaxTurns: defaults.defaultMaxTurns ?? undefined,
          }),
        });
      } else {
        const created = await createGroup({
          name: name.trim(),
          color,
          description: description.trim() || undefined,
        });
        if (created) {
          // createGroup() doesn't accept the richer-default fields; flush
          // them via a follow-up update if the user filled any of them.
          const followUp: Parameters<typeof updateGroup>[1] = {};
          if (sharedInstructions.trim().length > 0) followUp.sharedInstructions = sharedInstructions;
          if (defaults.defaultModelProfile) followUp.defaultModelProfile = defaults.defaultModelProfile;
          if (defaults.defaultMaxBudgetUsd != null) followUp.defaultMaxBudgetUsd = defaults.defaultMaxBudgetUsd;
          if (defaults.defaultMaxTurns != null) followUp.defaultMaxTurns = defaults.defaultMaxTurns;
          if (Object.keys(followUp).length > 0) {
            await updateGroup(created.id, followUp);
          }
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

        {/* Defaults — applied to new personas that land in this group. */}
        <div className="pt-2 border-t border-primary/10">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h3 className="typo-heading text-foreground/90">{t.pipeline.groups.defaults_heading}</h3>
            {isEditing && (
              <button
                type="button"
                onClick={async () => {
                  await clearGroupDefaultsAction(group.id);
                  // Mirror the cleared state in the form so the user sees the result.
                  setDefaultModel('');
                  setDefaultBudget('');
                  setDefaultTurns('');
                  setSharedInstructions('');
                }}
                className="typo-label text-foreground/60 hover:text-red-400 transition-colors underline-offset-2 hover:underline"
                title={t.pipeline.groups.clear_defaults_title}
              >
                {t.pipeline.groups.clear_defaults_action}
              </button>
            )}
          </div>
          <p className="typo-label text-foreground mb-3">{t.pipeline.groups.defaults_hint}</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block typo-label text-foreground/90 mb-1">
                {t.pipeline.groups.field_default_model}
              </label>
              <select
                value={defaultModel}
                onChange={(e) => setDefaultModel(e.target.value)}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40"
              >
                {GROUP_MODEL_CHOICES.map((c) => {
                  const path = c.labelKey.split('.') as ['pipeline', 'groups', string];
                  const label = (t.pipeline.groups as Record<string, string>)[path[2]] ?? c.id;
                  return (
                    <option key={c.id || '__none__'} value={c.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="block typo-label text-foreground/90 mb-1">
                {t.pipeline.groups.field_default_budget}
              </label>
              <input
                type="number"
                value={defaultBudget}
                onChange={(e) => setDefaultBudget(e.target.value)}
                placeholder={t.pipeline.groups.field_default_budget_placeholder}
                min={0}
                step={0.01}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40"
              />
            </div>
            <div>
              <label className="block typo-label text-foreground/90 mb-1">
                {t.pipeline.groups.field_default_turns}
              </label>
              <input
                type="number"
                value={defaultTurns}
                onChange={(e) => setDefaultTurns(e.target.value)}
                placeholder={t.pipeline.groups.field_default_turns_placeholder}
                min={0}
                step={1}
                className="w-full px-3 py-2 rounded-input bg-secondary/40 border border-primary/15 text-foreground/90 typo-body focus:outline-none focus:border-indigo-500/40"
              />
            </div>
          </div>
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
