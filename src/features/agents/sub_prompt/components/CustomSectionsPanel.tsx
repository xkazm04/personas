import { Plus, X } from 'lucide-react';
import { SectionEditor } from '@/features/shared/components/editors/draft-editor/SectionEditor';
import { useTranslation } from '@/i18n/useTranslation';

interface CustomSection {
  title: string;
  content: string;
}

interface CustomSectionsPanelProps {
  sections: CustomSection[];
  selectedIndex: number;
  onSelectIndex: (index: number) => void;
  onAdd: () => void;
  onUpdate: (index: number, field: 'title' | 'content', value: string) => void;
  onRemove: (index: number) => void;
}

export function CustomSectionsPanel({
  sections,
  selectedIndex,
  onSelectIndex,
  onAdd,
  onUpdate,
  onRemove,
}: CustomSectionsPanelProps) {
  const { t, tx } = useTranslation();
  const currentCustom = sections[selectedIndex];

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground/80">{t.agents.custom_sections.title}</span>
        <button
          onClick={onAdd}
          className="px-2 py-1 text-sm rounded-card border border-primary/20 text-muted-foreground/80 hover:bg-secondary/50 flex items-center gap-1 ml-auto"
        >
          <Plus className="w-3 h-3" />
          {t.agents.custom_sections.add}
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/80">{t.agents.custom_sections.no_sections}</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* Custom section list */}
          <div className="w-36 flex-shrink-0 space-y-0.5 overflow-y-auto">
            {sections.map((section, index) => (
              <div
                key={index}
                className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-card cursor-pointer transition-colors ${
                  selectedIndex === index
                    ? 'bg-violet-500/10 text-foreground/80 border border-violet-500/20'
                    : 'text-muted-foreground/90 hover:bg-secondary/30 border border-transparent'
                }`}
                onClick={() => onSelectIndex(index)}
              >
                <span className="truncate flex-1">
                  {section.title || tx(t.agents.custom_sections.section_fallback, { index: index + 1 })}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                  className="p-0.5 text-muted-foreground/80 hover:text-red-400 flex-shrink-0"
                  title={t.agents.custom_sections.remove_section}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Custom section editor */}
          {currentCustom && (
            <div className="flex-1 min-w-0 min-h-0 flex flex-col gap-2">
              <input
                type="text"
                value={currentCustom.title}
                onChange={(e) => onUpdate(selectedIndex, 'title', e.target.value)}
                className="px-3 py-1.5 bg-background/50 border border-primary/20 rounded-modal text-sm text-foreground placeholder-muted-foreground/30 focus-ring flex-shrink-0"
                placeholder={t.agents.custom_sections.title_placeholder}
              />
              <div className="flex-1 min-h-0">
                <SectionEditor
                  value={currentCustom.content}
                  onChange={(v) => onUpdate(selectedIndex, 'content', v)}
                  label={currentCustom.title || t.agents.custom_sections.custom_section}
                  placeholder={t.agents.custom_sections.content_placeholder}
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
