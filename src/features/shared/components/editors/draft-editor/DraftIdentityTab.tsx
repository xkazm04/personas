import { useState } from 'react';
import { User, FileText, Lightbulb } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import { SectionEditor } from './SectionEditor';
import { DesignContextViewer } from './DesignContextViewer';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t } = useTranslation();
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
              className={`w-full flex items-center gap-2 px-2.5 py-2 typo-heading rounded-xl transition-colors text-left ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/90 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
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
              <label className="block typo-heading text-foreground/80 mb-1.5">{t.shared.draft_editor.name_label}</label>
              <input
                type="text"
                value={draft.name ?? ''}
                onChange={(e) => updateDraft((curr) => ({ ...curr, name: e.target.value || null }))}
                onBlur={(e) => {
                  const trimmed = e.target.value.trim();
                  if (trimmed !== e.target.value) {
                    updateDraft((curr) => ({ ...curr, name: trimmed || null }));
                  }
                }}
                disabled={disabled}
                placeholder={t.shared.draft_editor.name_input_placeholder}
                className="w-full px-3 py-2.5 bg-background/50 border border-primary/15 rounded-xl typo-body text-foreground placeholder-muted-foreground/30 focus-ring transition-all"
              />
            </div>

            <div>
              <label className="block typo-heading text-foreground/80 mb-1.5">{t.shared.draft_editor.description_label}</label>
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
                placeholder={t.shared.draft_editor.description_input_placeholder}
                className="w-full px-3 py-2.5 bg-background/50 border border-primary/15 rounded-xl typo-body text-foreground placeholder-muted-foreground/30 focus-ring transition-all resize-y"
              />
            </div>
          </div>
        )}

        {subtab === 'system_prompt' && (
          <SectionEditor
            value={draft.system_prompt}
            onChange={(v) => updateDraft((curr) => ({ ...curr, system_prompt: v }))}
            label="System Prompt"
            placeholder={t.shared.draft_editor.system_prompt_placeholder}
            disabled={disabled}
          />
        )}

        {subtab === 'design_context' && (
          <DesignContextViewer
            value={draft.design_context ?? ''}
            onChange={(v) =>
              updateDraft((curr) => ({
                ...curr,
                design_context: v.trim() ? v : null,
              }))
            }
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}
