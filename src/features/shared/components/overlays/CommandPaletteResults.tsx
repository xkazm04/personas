import { ArrowRight } from 'lucide-react';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';
import type { ResultKind, PaletteItem } from './commandPaletteUtils';

interface PaletteSection {
  kind: ResultKind;
  label: string;
  items: (PaletteItem & { globalIndex: number })[];
}

interface CommandPaletteResultsProps {
  sections: PaletteSection[];
  selectedIndex: number;
  onExecute: (item: PaletteItem) => void;
  onHover: (index: number) => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}

export function CommandPaletteResults({
  sections,
  selectedIndex,
  onExecute,
  onHover,
  listRef,
}: CommandPaletteResultsProps) {
  const { canScrollUp, canScrollDown } = useScrollShadow(listRef);

  return (
    <div className="relative">
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
        {sections.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground/50">
            No results found
          </div>
        )}

        {sections.map(section => (
          <div key={section.kind}>
            <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60">
              {section.label}
            </div>
            {section.items.map(item => (
              <button
                key={item.id}
                data-index={item.globalIndex}
                onClick={() => onExecute(item)}
                onMouseEnter={() => onHover(item.globalIndex)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  selectedIndex === item.globalIndex
                    ? 'bg-primary/10 text-foreground'
                    : 'text-foreground/80 hover:bg-secondary/40'
                }`}
              >
                <span className={`shrink-0 ${selectedIndex === item.globalIndex ? 'text-primary' : 'text-muted-foreground/60'}`}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate text-sm">{item.label}</span>
                {item.description && (
                  <span className="text-xs text-muted-foreground/60 truncate max-w-[140px]">
                    {item.description}
                  </span>
                )}
                {selectedIndex === item.globalIndex && (
                  <ArrowRight className="w-3 h-3 text-primary/50 shrink-0" />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div
        className={`absolute top-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'linear-gradient(to bottom, var(--background), transparent)' }}
      />
      <div
        className={`absolute bottom-0 inset-x-0 h-6 pointer-events-none z-[1] transition-opacity duration-200 ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
        style={{ background: 'linear-gradient(to top, var(--background), transparent)' }}
      />
    </div>
  );
}
