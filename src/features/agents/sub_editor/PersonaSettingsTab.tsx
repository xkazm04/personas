import { Trash2, AlertTriangle, Loader2, Check } from 'lucide-react';
import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { AccessibleToggle } from '@/features/shared/components/AccessibleToggle';
import { PopupIconSelector } from '@/features/shared/components/PopupIconSelector';
import { PopupColorPicker } from '@/features/shared/components/PopupColorPicker';
import type { ConnectorDefinition } from '@/lib/types/types';

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
    <div className="max-w-3xl space-y-4">
      {/* Identity */}
      <div className="space-y-3">
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
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground/80 mb-1">Description</label>
            <textarea
              value={draft.description}
              onChange={(e) => patch({ description: e.target.value })}
              rows={4}
              className="w-full px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-none"
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
              <label className="block text-sm font-medium text-foreground/80 mb-1">Max Concurrent</label>
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
              <label className="block text-sm font-medium text-foreground/80 mb-1">Timeout (sec)</label>
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
            <span className="text-sm font-medium text-foreground/80">Persona Enabled</span>
            <AccessibleToggle
              checked={draft.enabled}
              onChange={() => patch({ enabled: !draft.enabled })}
              label="Persona Enabled"
              size="md"
            />
          </div>
        </div>
      </div>

      {/* Save status + Danger */}
      <div className="flex items-center justify-between pt-2 border-t border-primary/10">
        <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
          {isSaving ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/70" />
              <span>Saving {changedSections.join(' + ').toLowerCase()}...</span>
            </>
          ) : isDirty ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground/50" />
              <span>{changedSections.join(' + ')} changed</span>
            </>
          ) : (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-400/70" />
              <span className="text-muted-foreground/60">All changes saved</span>
            </>
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
              className="px-3 py-1.5 bg-secondary/50 text-foreground/80 rounded-lg text-sm transition-colors hover:bg-secondary/70"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
