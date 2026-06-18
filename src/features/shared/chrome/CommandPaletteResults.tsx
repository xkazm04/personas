import { ArrowRight } from 'lucide-react';
import { useScrollShadow } from '@/hooks/utility/interaction/useScrollShadow';
import type { ResultKind, PaletteItem } from '@/features/shared/chrome/commandPaletteUtils';
import { useTranslation } from '@/i18n/useTranslation';

const KIND_COLORS: Record<ResultKind, { icon: string; border: string }> = {
  agent:          { icon: 'text-violet-400',            border: 'border-l-violet-400' },
  credential:     { icon: 'text-emerald-400',           border: 'border-l-emerald-400' },
  template:       { icon: 'text-cyan-400',              border: 'border-l-cyan-400' },
  automation:     { icon: 'text-amber-400',             border: 'border-l-amber-400' },
  navigation:     { icon: 'text-foreground',   border: 'border-l-muted-foreground/70' },
  action:         { icon: 'text-foreground',   border: 'border-l-muted-foreground/70' },
  'agent-action': { icon: 'text-violet-300',            border: 'border-l-violet-300' },
  setting:        { icon: 'text-sky-400',               border: 'border-l-sky-400' },
};

/**
 * Read-only switch glyph rendered inside a toggle result row. The row itself is
 * the `<button>` that flips the setting (a real nested `<button>` would be
 * invalid markup), so this is purely presentational and aria-hidden — the row
 * announces its state via `aria-pressed`.
 */
function ToggleGlyph({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`shrink-0 w-8 h-[18px] rounded-full relative transition-colors duration-200 ${
        on ? 'bg-emerald-500/80' : 'bg-muted-foreground/25'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-white shadow-elevation-1 transition-transform duration-200 ${
          on ? 'translate-x-[14px]' : 'translate-x-0'
        }`}
      />
    </span>
  );
}

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
  const { t } = useTranslation();
  const { canScrollUp, canScrollDown } = useScrollShadow(listRef);

  return (
    <div className="relative">
      <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
        {sections.length === 0 && (
          <div className="px-4 py-8 text-center typo-body text-foreground">
            {t.shared.use_cases_extra.no_results}
          </div>
        )}

        {sections.map(section => (
          <div key={section.kind}>
            <div className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-foreground">
              {section.label}
            </div>
            {section.items.map(item => {
              const colors = KIND_COLORS[item.kind];
              const isSelected = selectedIndex === item.globalIndex;
              return (
              <button
                key={item.id}
                data-index={item.globalIndex}
                onClick={() => onExecute(item)}
                onMouseEnter={() => onHover(item.globalIndex)}
                aria-pressed={item.toggle ? item.toggle.isOn : undefined}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors border-l-2 ${
                  isSelected
                    ? `${colors.border} bg-secondary/30 text-foreground`
                    : 'border-l-transparent text-foreground hover:bg-secondary/40'
                }`}
              >
                <span className={`shrink-0 ${colors.icon}`}>
                  {item.icon}
                </span>
                <span className="flex-1 truncate typo-body">{item.label}</span>
                {item.description && (
                  <span className="typo-caption text-foreground truncate max-w-[140px]">
                    {item.description}
                  </span>
                )}
                {item.toggle ? (
                  <ToggleGlyph on={item.toggle.isOn} />
                ) : isSelected ? (
                  <ArrowRight className="w-3 h-3 text-primary/50 shrink-0" />
                ) : null}
              </button>
              );
            })}
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
