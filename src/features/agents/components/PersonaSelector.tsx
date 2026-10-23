import { useState, useMemo } from 'react';
import { ChevronDown, Check, Bot } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { Listbox } from '@/features/shared/components/forms/Listbox';

interface PersonaSelectorProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
  placeholder?: string;
  showAll?: boolean;
  /** Render each option's description beneath its name. Default true. */
  showDescription?: boolean;
}

/**
 * Universal themed persona selector with search, icons, and app-theme tones.
 * Sorted by name ascending. Designed for reuse across the app.
 */
export function PersonaSelector({
  value,
  onChange,
  personas,
  placeholder: placeholderProp,
  showAll = true,
  showDescription = true,
}: PersonaSelectorProps) {
  const { t } = useTranslation();
  const placeholder = placeholderProp ?? t.common.select_persona;
  const [search, setSearch] = useState('');

  // Sort personas by name ascending
  const sorted = useMemo(
    () => [...personas].sort((a, b) => a.name.localeCompare(b.name)),
    [personas],
  );

  // Filter by search
  const filtered = useMemo(() => {
    if (!search) return sorted;
    const q = search.toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }, [sorted, search]);

  // Selected persona
  const selected = value ? personas.find((p) => p.id === value) : null;

  // Keyboard model (Listbox): index 0 is the "All" row when shown, then the
  // filtered personas. Listbox owns arrows, Enter, Escape and click-outside.
  // The "All" row hides while searching so type-ahead's first match is a persona.
  const showAllRow = showAll && !search;
  const offset = showAllRow ? 1 : 0;
  const pick = (id: string) => { onChange(id); setSearch(''); };

  return (
    <Listbox
      ariaLabel={placeholder}
      itemCount={filtered.length + offset}
      searchable={sorted.length > 5}
      searchPlaceholder={t.common.search_ellipsis}
      onSearchChange={setSearch}
      onSelectFocused={(i) => {
        if (showAllRow && i === 0) return pick('');
        const next = filtered[i - offset];
        if (next) pick(next.id);
      }}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={() => { setSearch(''); toggle(); }}
          aria-haspopup="listbox"
          aria-expanded={isOpen}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all min-w-[180px] ${isOpen
              ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
              : 'border-primary/15 bg-secondary/20 hover:border-primary/25 hover:bg-secondary/30'
            }`}
        >
          {selected ? (
            <>
              <PersonaIcon icon={selected.icon} color={selected.color} frameSize={"lg"} />
              <span className="typo-body text-foreground/85 truncate flex-1 text-left">{selected.name}</span>
            </>
          ) : (
            <>
              <Bot className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
              <span className="typo-body text-foreground flex-1 text-left">{showAll ? t.common.all_personas : placeholder}</span>
            </>
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-foreground flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
      menuClassName="animate-fade-slide-in absolute top-full left-0 mt-1 z-50 w-full min-w-[240px] max-h-[320px] rounded-xl border border-primary/15 bg-background shadow-elevation-3 shadow-black/20 overflow-y-auto flex flex-col"
    >
      {({ close, focusIndex }) => (
        <div className="flex-1 py-1">
          {showAllRow && (
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={() => { pick(''); close(); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!value ? 'bg-primary/8 text-foreground/90' : 'text-foreground hover:bg-secondary/30'
                } ${focusIndex === 0 ? 'bg-secondary/40' : ''}`}
            >
              <Bot className="w-4 h-4 text-foreground flex-shrink-0" />
              <span className="typo-body flex-1">{t.common.all_personas}</span>
              {!value && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
            </button>
          )}

          {filtered.map((p, idx) => {
            const isActive = value === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => { pick(p.id); close(); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${isActive ? 'bg-primary/8 text-foreground/90' : 'text-foreground hover:bg-secondary/30'
                  } ${focusIndex === idx + offset ? 'bg-secondary/40' : ''}`}
              >
                <PersonaIcon icon={p.icon} color={p.color} />
                <div className="flex-1 min-w-0">
                  <span className="typo-body truncate block">{p.name}</span>
                  {showDescription && p.description && (
                    <span className="text-[11px] text-foreground truncate block">{p.description.slice(0, 60)}</span>
                  )}
                </div>
                {isActive && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </button>
            );
          })}

          {filtered.length === 0 && search && (
            <div className="px-3 py-4 typo-caption text-foreground text-center">{t.common.no_personas_matching.replace('{query}', search)}</div>
          )}
        </div>
      )}
    </Listbox>
  );
}
