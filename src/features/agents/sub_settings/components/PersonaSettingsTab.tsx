import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { PopupIconSelector } from '@/features/shared/components/forms/PopupIconSelector';
import { PopupColorPicker } from '@/features/shared/components/forms/PopupColorPicker';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import type { ConnectorDefinition } from '@/lib/types/types';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { SettingsStatusBar } from './SettingsStatusBar';
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import { useAgentStore } from '@/stores/agentStore';
import { useTier } from '@/hooks/utility/interaction/useTier';

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
  const { t } = useTranslation();
  const personaId = useAgentStore((s) => s.selectedPersonaId);
  const { isStarter: isSimple } = useTier();
  const [retentionMonths, setRetentionMonths] = useState<number>(2);

  useEffect(() => {
    if (!personaId) return;
    invokeWithTimeout<string | null>('get_setting', { key: `execution_retention_months:${personaId}` })
      .then((val: string | null) => { if (val) setRetentionMonths(parseInt(val, 10) || 2); })
      .catch(() => { /* use default */ });
  }, [personaId]);

  const handleRetentionChange = useCallback((months: number) => {
    setRetentionMonths(months);
    if (!personaId) return;
    invokeWithTimeout('set_setting', { key: `execution_retention_months:${personaId}`, value: String(months) }).catch(() => { /* ignore */ });
  }, [personaId]);

  return (
    <div className="max-w-3xl 3xl:max-w-4xl 4xl:max-w-5xl space-y-4">
      {/* Identity -- relative z-10 so icon/color picker popups render above cards below */}
      <div className="space-y-3 relative z-10">
        <h4 className="flex items-center gap-2.5 typo-submodule-header tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          {t.agents.settings_status.identity}
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
          <div>
            <label className="block typo-body font-medium text-foreground mb-1">{t.agents.settings_status.label_name}</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              data-testid="agent-name"
              className={INPUT_FIELD}
            />
          </div>
          <div>
            <label className="block typo-body font-medium text-foreground mb-1">{t.agents.settings_status.label_description}</label>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={4}
              data-testid="agent-description"
              className={`${INPUT_FIELD} resize-none`}
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="block typo-body font-medium text-foreground mb-2">{t.agents.settings_status.label_icon}</label>
              <PopupIconSelector
                value={draft.icon}
                onChange={(icon) => patch({ icon })}
                connectors={connectorDefinitions}
                size="sm"
              />
            </div>
            <div>
              <label className="block typo-body font-medium text-foreground mb-2">{t.agents.settings_status.label_color}</label>
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
        <h4 className="flex items-center gap-2.5 typo-submodule-header tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          {t.agents.settings_status.execution}
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/20 rounded-modal p-3 space-y-3">
          {!isSimple && (
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block typo-body font-medium text-foreground mb-1">
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
                <label className="block typo-body font-medium text-foreground mb-1">
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
          )}

          {!isSimple && (
            <div className="flex-1">
              <label className="block typo-body font-medium text-foreground mb-1">
                {t.agents.settings_status.execution_retention}
                <FieldHint
                  text="How long execution history is kept before automatic cleanup. Older executions are deleted to save disk space."
                  range="1--24 months"
                  example="2"
                />
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={retentionMonths}
                  onChange={(e) => handleRetentionChange(parseInt(e.target.value, 10) || 2)}
                  min={1}
                  max={24}
                  className={`${INPUT_FIELD} w-20`}
                />
                <span className="typo-body text-foreground">{t.agents.settings_status.months}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between py-1">
            <span className="typo-body font-medium text-foreground">{t.agents.settings_status.persona_enabled}</span>
            <AccessibleToggle
              checked={draft.enabled}
              onChange={() => patch({ enabled: !draft.enabled })}
              label={t.agents.settings_status.persona_enabled}
              data-testid="agent-enabled"
              size="md"
            />
          </div>

          {!isSimple && (
            <div className="flex items-center justify-between py-1">
              <div>
                <span className="typo-body font-medium text-foreground">{t.agents.settings_status.sensitive_preview}</span>
                <p className="typo-body text-foreground">{t.agents.settings_status.sensitive_preview_desc}</p>
              </div>
              <AccessibleToggle
                checked={draft.sensitive}
                onChange={() => patch({ sensitive: !draft.sensitive })}
                label={t.agents.settings_status.sensitive_preview}
                size="md"
              />
            </div>
          )}
        </div>
      </div>

      {/* Save status + Danger */}
      <SettingsStatusBar
        isSaving={isSaving}
        isDirty={isDirty}
        changedSections={changedSections}
        showDeleteConfirm={showDeleteConfirm}
        setShowDeleteConfirm={setShowDeleteConfirm}
        onDelete={onDelete}
      />
    </div>
  );
}
