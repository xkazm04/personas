import { Settings } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';

interface DraftSettingsTabProps {
  draft: N8nPersonaDraft;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
}

export function DraftSettingsTab({ draft, disabled, updateDraft }: DraftSettingsTabProps) {
  return (
    <div className="space-y-4 bg-secondary/20 border border-primary/10 rounded-2xl p-4">
      <h5 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/70 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        <Settings className="w-3.5 h-3.5" />
        Runtime Settings
      </h5>

      {/* Appearance */}
      <div className="space-y-3">
        <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Appearance</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1">Icon</label>
            <input
              type="text"
              value={draft.icon ?? ''}
              onChange={(e) => updateDraft((curr) => ({ ...curr, icon: e.target.value.trim() || null }))}
              disabled={disabled}
              placeholder="Sparkles, Bot, Zap..."
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={draft.color ?? '#8b5cf6'}
                onChange={(e) => updateDraft((curr) => ({ ...curr, color: e.target.value }))}
                disabled={disabled}
                className="w-9 h-9 rounded-lg cursor-pointer border border-primary/15 bg-transparent"
              />
              <input
                type="text"
                value={draft.color ?? ''}
                onChange={(e) => updateDraft((curr) => ({ ...curr, color: e.target.value.trim() || null }))}
                disabled={disabled}
                placeholder="#8b5cf6"
                className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Limits */}
      <div className="space-y-3 pt-2 border-t border-primary/10">
        <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Limits</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1">Max Budget (USD)</label>
            <input
              type="number"
              value={draft.max_budget_usd ?? ''}
              onChange={(e) =>
                updateDraft((curr) => ({
                  ...curr,
                  max_budget_usd: e.target.value === '' ? null : Number(e.target.value),
                }))
              }
              min={0}
              step={0.01}
              disabled={disabled}
              placeholder="No limit"
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground/60 mb-1">Max Turns</label>
            <input
              type="number"
              value={draft.max_turns ?? ''}
              onChange={(e) =>
                updateDraft((curr) => ({
                  ...curr,
                  max_turns: e.target.value === '' ? null : Number.parseInt(e.target.value, 10),
                }))
              }
              min={1}
              step={1}
              disabled={disabled}
              placeholder="No limit"
              className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
            />
          </div>
        </div>
      </div>

      {/* Model */}
      <div className="space-y-3 pt-2 border-t border-primary/10">
        <p className="text-[11px] font-semibold text-muted-foreground/50 uppercase tracking-wider">Model</p>
        <div>
          <label className="block text-xs font-medium text-foreground/60 mb-1">Model Profile</label>
          <input
            type="text"
            value={draft.model_profile ?? ''}
            onChange={(e) =>
              updateDraft((curr) => ({
                ...curr,
                model_profile: e.target.value.trim() ? e.target.value : null,
              }))
            }
            disabled={disabled}
            placeholder="Default model profile"
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-lg text-xs text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
          />
        </div>
      </div>
    </div>
  );
}
