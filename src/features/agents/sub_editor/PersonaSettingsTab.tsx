import { Trash2, Save, AlertTriangle } from 'lucide-react';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { ModelSelector } from '@/features/agents/sub_editor/model-config/ModelSelector';
import { NotificationChannelSettings } from '@/features/agents/sub_editor/NotificationChannelSettings';
import { EventSubscriptionSettings } from '@/features/agents/sub_editor/EventSubscriptionSettings';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import { IconSelector } from '@/features/shared/components/IconSelector';
import type { ConnectorDefinition, CredentialMetadata } from '@/lib/types/types';

interface PersonaSettingsTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  isDirty: boolean;
  settingsDirty: boolean;
  modelDirty: boolean;
  changedSections: string[];
  connectorDefinitions: ConnectorDefinition[];
  credentials: CredentialMetadata[];
  selectedPersonaId: string;
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
  onSaveAll: () => Promise<void>;
  onDelete: () => Promise<void>;
}

export function PersonaSettingsTab({
  draft,
  patch,
  isDirty,
  settingsDirty: _settingsDirty,
  modelDirty,
  changedSections,
  connectorDefinitions,
  credentials,
  selectedPersonaId,
  showDeleteConfirm,
  setShowDeleteConfirm,
  onSaveAll,
  onDelete,
}: PersonaSettingsTabProps) {
  return (
    <div className="max-w-2xl space-y-4">
      {/* Identity */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Identity
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Name</label>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={2}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-2">Icon</label>
            <IconSelector
              value={draft.icon}
              onChange={(icon) => patch({ icon })}
              connectors={connectorDefinitions}
              size="sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/60 mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.color}
                onChange={(e) => patch({ color: e.target.value })}
                className="w-8 h-8 rounded-lg cursor-pointer border border-primary/15 bg-transparent"
              />
              <span className="text-sm font-mono text-muted-foreground/40">{draft.color}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Model & Provider */}
      <ModelSelector draft={draft} patch={patch} modelDirty={modelDirty} />

      {/* Execution */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Execution
        </h4>
        <div className="bg-secondary/40 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-3">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/60 mb-1">Max Concurrent</label>
              <input
                type="number"
                value={draft.maxConcurrent}
                onChange={(e) => patch({ maxConcurrent: parseInt(e.target.value, 10) || 1 })}
                min={1}
                max={10}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-foreground/60 mb-1">Timeout (sec)</label>
              <input
                type="number"
                value={Math.round(draft.timeout / 1000)}
                onChange={(e) => patch({ timeout: (parseInt(e.target.value, 10) || 300) * 1000 })}
                min={10}
                step={10}
                className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>

          <div className="flex items-center justify-between py-1">
            <span className="text-sm font-medium text-foreground/60">Persona Enabled</span>
            <AccessibleToggle
              checked={draft.enabled}
              onChange={() => patch({ enabled: !draft.enabled })}
              label="Persona Enabled"
              size="md"
            />
          </div>
        </div>
      </div>

      {/* Notification Channels */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Notifications
        </h4>
        <NotificationChannelSettings
          personaId={selectedPersonaId}
          credentials={credentials}
          connectorDefinitions={connectorDefinitions}
        />
      </div>

      {/* Event Subscriptions */}
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          Event Subscriptions
        </h4>
        <EventSubscriptionSettings personaId={selectedPersonaId} />
      </div>

      {/* Unified Save + Danger */}
      <div className="flex items-center justify-between pt-2 border-t border-primary/10">
        <div className="flex items-center gap-3">
          <button
            onClick={onSaveAll}
            disabled={!isDirty}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg font-medium text-sm transition-all ${
              isDirty
                ? 'bg-gradient-to-r from-primary to-accent text-foreground shadow-lg shadow-primary/20 hover:from-primary/90 hover:to-accent/90'
                : 'bg-secondary/40 text-muted-foreground/30 cursor-not-allowed'
            }`}
          >
            <Save className="w-3.5 h-3.5" />
            Save All
            {isDirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />}
          </button>
          {isDirty && (
            <span className="text-[11px] text-muted-foreground/40">
              {changedSections.join(' + ')} changed
            </span>
          )}
        </div>

        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-sm text-amber-400/70 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Irreversible
            </span>
            <button
              onClick={onDelete}
              className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-lg text-sm font-medium transition-colors"
            >
              Confirm
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="px-3 py-1.5 bg-secondary/50 text-foreground/60 rounded-lg text-sm transition-colors hover:bg-secondary/70"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
