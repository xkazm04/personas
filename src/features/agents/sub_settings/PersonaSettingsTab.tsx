import { Trash2, AlertTriangle, Check } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { PopupIconSelector } from '@/features/shared/components/forms/PopupIconSelector';
import { PopupColorPicker } from '@/features/shared/components/forms/PopupColorPicker';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import type { ConnectorDefinition } from '@/lib/types/types';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { TwinBindingCard } from './TwinBindingCard';

interface PersonaSettingsTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  isDirty: boolean;
  changedSections: string[];
  connectorDefinitions: ConnectorDefinition[];
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
  isSaving: boolean;
  onDelete: () => Promise<void>;
}

export function PersonaSettingsTab({
  draft,
  patch,
  isDirty,
  changedSections,
  connectorDefinitions,
  showDeleteConfirm,
  setShowDeleteConfirm,
  isSaving,
  onDelete,
}: PersonaSettingsTabProps) {
  const { t, tx } = useTranslation();
  return (
    <div className="max-w-3xl space-y-4">
      {/* Identity -- relative z-10 so icon/color picker popups render above cards below */}
      <div className="space-y-3 relative z-10">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          {t.agents.settings_status.identity}
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.agents.settings_status.label_name}</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={INPUT_FIELD}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">{t.agents.settings_status.label_description}</label>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={4}
              className={`${INPUT_FIELD} resize-none`}
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t.agents.settings_status.label_icon}</label>
              <PopupIconSelector
                value={draft.icon}
                onChange={(icon) => patch({ icon })}
                connectors={connectorDefinitions}
                size="sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">{t.agents.settings_status.label_color}</label>
              <PopupColorPicker
                value={draft.color}
                onChange={(color) => patch({ color })}
                size="sm"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Execution */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          {t.agents.settings_status.execution}
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1">
                {t.agents.settings_status.max_concurrent}
                <FieldHint
                  text="Maximum parallel executions for this persona. Limits how many runs can happen at the same time to prevent API rate limits."
                  range="1--10"
                  example="3"
                />
              </label>
              <input
                type="number"
                value={draft.maxConcurrent}
                onChange={(e) => patch({ maxConcurrent: Math.min(50, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
                min={1}
                max={50}
                className={INPUT_FIELD}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground mb-1">
                {t.agents.settings_status.timeout_sec}
                <FieldHint
                  text="How long a single execution can run before being cancelled. The engine hard ceiling is 1800 seconds (30 min) — values above this are rejected."
                  range="10--1800 seconds"
                  example="300"
                />
              </label>
              <input
                type="number"
                value={Math.round(draft.timeout / 1000)}
                onChange={(e) => {
                  const raw = parseInt(e.target.value, 10) || 10;
                  patch({ timeout: Math.min(raw, 1800) * 1000 });
                }}
                min={10}
                max={1800}
                step={10}
                className={INPUT_FIELD}
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-foreground">{t.agents.settings_status.persona_enabled}</span>
            <AccessibleToggle
              checked={draft.enabled}
              onChange={() => patch({ enabled: !draft.enabled })}
              label={t.agents.settings_status.persona_enabled}
              size="md"
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm font-medium text-foreground">{t.agents.settings_status.sensitive_preview}</span>
              <p className="text-sm text-foreground">{t.agents.settings_status.sensitive_preview_desc}</p>
            </div>
            <AccessibleToggle
              checked={draft.sensitive}
              onChange={() => patch({ sensitive: !draft.sensitive })}
              label={t.agents.settings_status.sensitive_preview}
              size="md"
            />
          </div>
        </div>
      </div>

      {/* Twin binding — pin this persona to a specific twin or inherit the active one */}
      <TwinBindingCard />

      {/* Save status + Danger */}
      <div className="flex items-center justify-between pt-2 border-t border-primary/10">
        <div className="flex items-center gap-2 text-sm text-foreground">
          {isSaving ? (
            <>
              <LoadingSpinner size="sm" className="text-primary/70" />
              <span>{tx(t.agents.settings_status.saving, { sections: changedSections.join(' + ').toLowerCase() })}</span>
            </>
          ) : isDirty ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              <span>{tx(t.agents.settings_status.changed, { sections: changedSections.join(' + ') })}</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400/70" />
              <span className="text-foreground">{t.agents.settings_status.all_saved}</span>
            </>
          )}
        </div>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-modal transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.common.delete}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-400/70 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              {t.agents.settings_status.irreversible}
            </span>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-modal text-sm font-medium transition-colors"
            >
              {t.common.confirm}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 bg-secondary/50 text-foreground rounded-modal text-sm transition-colors hover:bg-secondary/70"
            >
              {t.common.cancel}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
