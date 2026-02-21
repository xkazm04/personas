import { useState } from 'react';
import { User, FileText, Lightbulb } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/design';
import { SectionEditor } from './SectionEditor';

interface DraftIdentityTabProps {
  draft: N8nPersonaDraft;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
}

type IdentitySubtab = 'overview' | 'system_prompt' | 'design_context';

const SUBTABS: { id: IdentitySubtab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'overview', label: 'Overview', Icon: User },
  { id: 'system_prompt', label: 'System Prompt', Icon: FileText },
  { id: 'design_context', label: 'Design Context', Icon: Lightbulb },
];

export function DraftIdentityTab({ draft, disabled, updateDraft }: DraftIdentityTabProps) {
  const [subtab, setSubtab] = useState<IdentitySubtab>('overview');

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Left subtab navigation */}
      <div className="w-36 flex-shrink-0 space-y-0.5">
        {SUBTABS.map((tab) => {
          const active = subtab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubtab(tab.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-xs font-medium rounded-lg transition-colors text-left ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/50 hover:text-muted-foreground/70 hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Right content area */}
      <div className="flex-1 min-w-0 min-h-0">
        {subtab === 'overview' && (
          <div className="space-y-4 h-full overflow-y-auto pr-1">
            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1.5">Name</label>
              <input
                type="text"
                value={draft.name ?? ''}
                onChange={(e) => updateDraft((curr) => ({ ...curr, name: e.target.value.trim() || null }))}
                disabled={disabled}
                placeholder="Give your persona a name..."
                className="w-full px-3 py-2.5 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-foreground/60 mb-1.5">Description</label>
              <textarea
                value={draft.description ?? ''}
                onChange={(e) =>
                  updateDraft((curr) => ({
                    ...curr,
                    description: e.target.value.trim() ? e.target.value : null,
                  }))
                }
                disabled={disabled}
                rows={6}
                placeholder="A brief description of what this persona does..."
                className="w-full px-3 py-2.5 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all resize-y"
              />
            </div>
          </div>
        )}

        {subtab === 'system_prompt' && (
          <SectionEditor
            value={draft.system_prompt}
            onChange={(v) => updateDraft((curr) => ({ ...curr, system_prompt: v }))}
            label="System Prompt"
            placeholder="The core instructions for this persona..."
            disabled={disabled}
          />
        )}

        {subtab === 'design_context' && (
          <SectionEditor
            value={draft.design_context ?? ''}
            onChange={(v) =>
              updateDraft((curr) => ({
                ...curr,
                design_context: v.trim() ? v : null,
              }))
            }
            label="Design Context"
            placeholder="Additional context about how this persona was designed..."
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
