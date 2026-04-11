import { useState, useMemo, useRef, useEffect } from 'react';
import { ChevronDown, Search, Check, Bot, X } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { useTranslation } from '@/i18n/useTranslation';

interface PersonaSelectorProps {
  value: string;
  onChange: (personaId: string) => void;
  personas: Persona[];
  placeholder?: string;
  showAll?: boolean;
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
}: PersonaSelectorProps) {
  const { t } = useTranslation();
  const placeholder = placeholderProp ?? t.common.select_persona;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

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

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Focus search on open
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all min-w-[180px] ${open
            ? 'border-primary/30 bg-primary/5 ring-1 ring-primary/20'
            : 'border-primary/15 bg-secondary/20 hover:border-primary/25 hover:bg-secondary/30'
          }`}
      >
        {selected ? (
          <>
            <PersonaIcon icon={selected.icon} color={selected.color} frameSize={"lg"} />
            <span className="text-sm font-medium text-foreground/85 truncate flex-1 text-left">{selected.name}</span>
          </>
        ) : (
          <>
            <Bot className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
            <span className="text-sm text-foreground flex-1 text-left">{showAll ? t.common.all_personas : placeholder}</span>
          </>
        )}
        <ChevronDown className={`w-3.5 h-3.5 text-foreground flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="animate-fade-slide-in absolute top-full left-0 mt-1 z-50 w-full min-w-[240px] max-h-[320px] rounded-xl border border-primary/15 bg-background shadow-xl shadow-black/20 overflow-hidden flex flex-col">
          {/* Search */}
          {sorted.length > 5 && (
            <div className="px-2.5 pt-2.5 pb-1.5">
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-primary/10 bg-secondary/20">
                <Search className="w-3 h-3 text-foreground" />
                <input
                  ref={searchRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t.common.search_ellipsis}
                  className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/30 outline-none"
                />
                {search && (
                  <button type="button" onClick={() => setSearch('')} className="text-foreground hover:text-foreground">
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Options */}
          <div className="flex-1 overflow-y-auto py-1">
            {/* All option */}
            {showAll && (
              <button
                type="button"
                onClick={() => { onChange(''); setOpen(false); setSearch(''); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${!value ? 'bg-primary/8 text-foreground/90' : 'text-muted-foreground/60 hover:bg-secondary/30'
                  }`}
              >
                <Bot className="w-4 h-4 text-foreground flex-shrink-0" />
                <span className="text-sm font-medium flex-1">{t.common.all_personas}</span>
                {!value && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </button>
            )}

            {/* Persona items */}
            {filtered.map((p) => {
              const isActive = value === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onChange(p.id); setOpen(false); setSearch(''); }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${isActive ? 'bg-primary/8 text-foreground/90' : 'text-foreground/70 hover:bg-secondary/30'
                    }`}
                >
                  <PersonaIcon icon={p.icon} color={p.color} />
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-medium truncate block">{p.name}</span>
                    {p.description && (
                      <span className="text-[11px] text-foreground truncate block">{p.description.slice(0, 60)}</span>
                    )}
                  </div>
                  {isActive && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
                </button>
              );
            })}

            {filtered.length === 0 && search && (
              <div className="px-3 py-4 text-xs text-foreground text-center">{t.common.no_personas_matching.replace('{query}', search)}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
