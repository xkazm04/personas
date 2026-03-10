import type { PersonaDraft } from '@/features/agents/sub_editor';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { PopupIconSelector } from '@/features/shared/components/forms/PopupIconSelector';
import { PopupColorPicker } from '@/features/shared/components/forms/PopupColorPicker';
import { FieldHint } from '@/features/shared/components/display/FieldHint';
import type { ConnectorDefinition } from '@/lib/types/types';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { SettingsStatusBar } from './SettingsStatusBar';

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
  return (
    <div className="max-w-3xl 3xl:max-w-4xl 4xl:max-w-5xl space-y-4">
      {/* Identity — relative z-10 so icon/color picker popups render above cards below */}
      <div className="space-y-3 relative z-10">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Identity
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className={INPUT_FIELD}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={4}
              className={`${INPUT_FIELD} resize-none`}
            />
          </div>
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Icon</label>
              <PopupIconSelector
                value={draft.icon}
                onChange={(icon) => patch({ icon })}
                connectors={connectorDefinitions}
                size="sm"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground/80 mb-2">Color</label>
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
          Execution
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Max Concurrent
                <FieldHint
                  text="Maximum parallel executions for this persona. Limits how many runs can happen at the same time to prevent API rate limits."
                  range="1–10"
                  example="3"
                />
              </label>
              <input
                type="number"
                value={draft.maxConcurrent}
                onChange={(e) => patch({ maxConcurrent: parseInt(e.target.value, 10) || 1 })}
                min={1}
                max={10}
                className={INPUT_FIELD}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/80 mb-1">
                Timeout (sec)
                <FieldHint
                  text="How long a single execution can run before being cancelled. Prevents stuck runs from consuming resources."
                  range="10–3600 seconds"
                  example="1000"
                />
              </label>
              <input
                type="number"
                value={Math.round(draft.timeout / 1000)}
                onChange={(e) => patch({ timeout: (parseInt(e.target.value, 10) || 1000) * 1000 })}
                min={10}
                step={10}
                className={INPUT_FIELD}
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-foreground/80">Persona Enabled</span>
            <AccessibleToggle
              checked={draft.enabled}
              onChange={() => patch({ enabled: !draft.enabled })}
              label="Persona Enabled"
              size="md"
            />
          </div>

          <div className="flex items-center justify-between py-1">
            <div>
              <span className="text-sm font-medium text-foreground/80">Sensitive Preview</span>
              <p className="text-sm text-muted-foreground/70">Mask hover preview details until revealed.</p>
            </div>
            <AccessibleToggle
              checked={draft.sensitive}
              onChange={() => patch({ sensitive: !draft.sensitive })}
              label="Sensitive Preview"
              size="md"
            />
          </div>
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
