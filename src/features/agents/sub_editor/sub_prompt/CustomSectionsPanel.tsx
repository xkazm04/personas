import { Plus, X } from 'lucide-react';
import { SectionEditor } from '@/features/shared/components/draft-editor/SectionEditor';

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
  const currentCustom = sections[selectedIndex];

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm font-medium text-foreground/80">Custom Sections</span>
        <button
          onClick={onAdd}
          className="px-2 py-1 text-sm rounded-lg border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 flex items-center gap-1 ml-auto"
        >
          <Plus className="w-3 h-3" />
          Add
        </button>
      </div>

      {sections.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground/80">No custom sections yet</p>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 gap-2">
          {/* Custom section list */}
          <div className="w-36 flex-shrink-0 space-y-0.5 overflow-y-auto">
            {sections.map((section, index) => (
              <div
                key={index}
                className={`flex items-center gap-1 px-2 py-1.5 text-sm rounded-lg cursor-pointer transition-colors ${
                  selectedIndex === index
                    ? 'bg-violet-500/10 text-foreground/80 border border-violet-500/20'
                    : 'text-muted-foreground/90 hover:bg-secondary/30 border border-transparent'
                }`}
                onClick={() => onSelectIndex(index)}
              >
                <span className="truncate flex-1">
                  {section.title || `Section ${index + 1}`}
                </span>
                <button
                  onClick={(e) => { e.stopPropagation(); onRemove(index); }}
                  className="p-0.5 text-muted-foreground/80 hover:text-red-400 flex-shrink-0"
                  title="Remove section"
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
                className="px-3 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 flex-shrink-0"
                placeholder="Section title..."
              />
              <div className="flex-1 min-h-0">
                <SectionEditor
                  value={currentCustom.content}
                  onChange={(v) => onUpdate(selectedIndex, 'content', v)}
                  label={currentCustom.title || 'Custom Section'}
                  placeholder="Section content..."
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
