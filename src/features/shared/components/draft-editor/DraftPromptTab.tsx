import { useState } from 'react';
import { BookOpen, User, Wrench, Code, AlertTriangle, Layers, Plus, X } from 'lucide-react';
import type { N8nPersonaDraft } from '@/api/n8nTransform';
import {
  type EditableStructuredPrompt,
  toEditableStructuredPrompt,
  fromEditableStructuredPrompt,
} from '@/lib/personas/promptMigration';
import { SectionEditor } from './SectionEditor';

interface DraftPromptTabProps {
  draft: N8nPersonaDraft;
  disabled: boolean;
  updateDraft: (updater: (current: N8nPersonaDraft) => N8nPersonaDraft) => void;
}

type PromptSubtab = 'identity' | 'instructions' | 'toolGuidance' | 'examples' | 'errorHandling' | 'custom';

const SUBTABS: { id: PromptSubtab; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'identity', label: 'Identity', Icon: User },
  { id: 'instructions', label: 'Instructions', Icon: BookOpen },
  { id: 'toolGuidance', label: 'Tool Guidance', Icon: Wrench },
  { id: 'examples', label: 'Examples', Icon: Code },
  { id: 'errorHandling', label: 'Error Handling', Icon: AlertTriangle },
  { id: 'custom', label: 'Custom', Icon: Layers },
];

export function DraftPromptTab({ draft, disabled, updateDraft }: DraftPromptTabProps) {
  const [subtab, setSubtab] = useState<PromptSubtab>('identity');
  const [selectedCustomIndex, setSelectedCustomIndex] = useState(0);

  const editable: EditableStructuredPrompt = toEditableStructuredPrompt(draft.structured_prompt);

  const updatePrompt = (next: EditableStructuredPrompt) => {
    updateDraft((curr) => ({
      ...curr,
      structured_prompt: fromEditableStructuredPrompt(next),
    }));
  };

  const isStandardField = (tab: PromptSubtab): tab is keyof Omit<EditableStructuredPrompt, 'customSections' | 'webSearch'> =>
    tab !== 'custom';

  return (
    <div className="flex h-full min-h-0 gap-3">
      {/* Left subtab navigation */}
      <div className="w-36 flex-shrink-0 space-y-0.5">
        {SUBTABS.map((tab) => {
          const active = subtab === tab.id;
          const hasContent = tab.id === 'custom'
            ? editable.customSections.length > 0
            : !!editable[tab.id as keyof Omit<EditableStructuredPrompt, 'customSections'>]?.trim();
          return (
            <button
              key={tab.id}
              onClick={() => setSubtab(tab.id)}
              className={`w-full flex items-center gap-2 px-2.5 py-2 text-sm font-medium rounded-lg transition-colors text-left ${
                active
                  ? 'bg-primary/10 text-foreground/80 border border-primary/20'
                  : 'text-muted-foreground/80 hover:text-muted-foreground hover:bg-secondary/30 border border-transparent'
              }`}
            >
              <tab.Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{tab.label}</span>
              {hasContent && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-emerald-400/60 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Right content area */}
      <div className="flex-1 min-w-0 min-h-0">
        {/* Standard prompt fields */}
        {isStandardField(subtab) && (
          <SectionEditor
            value={editable[subtab]}
            onChange={(v) => updatePrompt({ ...editable, [subtab]: v })}
            label={SUBTABS.find((t) => t.id === subtab)?.label ?? subtab}
            placeholder={`Enter ${SUBTABS.find((t) => t.id === subtab)?.label.toLowerCase()} content...`}
            disabled={disabled}
          />
        )}

        {/* Custom sections */}
        {subtab === 'custom' && (
          <div className="flex flex-col h-full min-h-0 gap-2">
            {/* Custom section toolbar */}
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-sm font-medium text-foreground/80">Custom Sections</span>
              <button
                onClick={() => {
                  const next = {
                    ...editable,
                    customSections: [
                      ...editable.customSections,
                      { key: '', label: 'New Section', content: '' },
                    ],
                  };
                  updatePrompt(next);
                  setSelectedCustomIndex(next.customSections.length - 1);
                }}
                disabled={disabled}
                className="px-2 py-1 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 disabled:opacity-50 flex items-center gap-1 ml-auto"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
            </div>

            {editable.customSections.length === 0 ? (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-sm text-muted-foreground/80">No custom sections yet</p>
              </div>
            ) : (
              <div className="flex flex-1 min-h-0 gap-2">
                {/* Custom section list */}
                <div className="w-36 flex-shrink-0 space-y-0.5 overflow-y-auto">
                  {editable.customSections.map((section, index) => (
                    <div
                      key={`${index}-${section.key}`}
                      className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
                        selectedCustomIndex === index
                          ? 'bg-violet-500/10 text-foreground/80 border border-violet-500/20'
                          : 'text-muted-foreground/90 hover:bg-secondary/30 border border-transparent'
                      }`}
                      onClick={() => setSelectedCustomIndex(index)}
                    >
                      <span className="truncate flex-1">
                        {section.label || section.key || `Section ${index + 1}`}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          updatePrompt({
                            ...editable,
                            customSections: editable.customSections.filter((_, i) => i !== index),
                          });
                          if (selectedCustomIndex >= editable.customSections.length - 1) {
                            setSelectedCustomIndex(Math.max(0, editable.customSections.length - 2));
                          }
                        }}
                        disabled={disabled}
                        className="p-0.5 text-muted-foreground/80 hover:text-red-400 flex-shrink-0"
                        title="Remove section"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>

                {/* Custom section editor */}
                {editable.customSections[selectedCustomIndex] && (
                  <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
                    <div className="flex gap-2 flex-shrink-0">
                      <input
                        type="text"
                        value={editable.customSections[selectedCustomIndex]!.key}
                        placeholder="key"
                        onChange={(e) => {
                          const nextSections = editable.customSections.map((entry, i) =>
                            i === selectedCustomIndex ? { ...entry, key: e.target.value } : entry,
                          );
                          updatePrompt({ ...editable, customSections: nextSections });
                        }}
                        disabled={disabled}
                        className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <input
                        type="text"
                        value={editable.customSections[selectedCustomIndex]!.label}
                        placeholder="label"
                        onChange={(e) => {
                          const nextSections = editable.customSections.map((entry, i) =>
                            i === selectedCustomIndex ? { ...entry, label: e.target.value } : entry,
                          );
                          updatePrompt({ ...editable, customSections: nextSections });
                        }}
                        disabled={disabled}
                        className="flex-1 px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                    </div>
                    <div className="flex-1 min-h-0">
                      <SectionEditor
                        value={editable.customSections[selectedCustomIndex]!.content}
                        onChange={(v) => {
                          const nextSections = editable.customSections.map((entry, i) =>
                            i === selectedCustomIndex ? { ...entry, content: v } : entry,
                          );
                          updatePrompt({ ...editable, customSections: nextSections });
                        }}
                        label={editable.customSections[selectedCustomIndex]!.label || 'Custom Section'}
                        placeholder="Section content..."
                        disabled={disabled}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
