import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Plus, Search, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { TwinProfile } from '@/lib/bindings/TwinProfile';

/**
 * Replaces the native <select> twin dropdown in TwinSelector with a
 * keyboard-searchable popover. The native select hit a wall at ~5+ twins
 * (no search, no recency, no inline "create" affordance). This picker is
 * a command-menu-style popover anchored to the trigger button:
 *
 * - Type to filter by name / role.
 * - Arrow keys + Enter to pick.
 * - Active twin is pinned at the top + marked.
 * - Footer "Create new twin" CTA routes to the Profiles tab so the existing
 *   wizard is the single source of truth for the create flow.
 */

interface Props {
  profiles: readonly TwinProfile[];
  activeTwinId: string | null;
  onSelect: (id: string) => void;
  /** Called when the user picks "Create new twin". The parent routes to
   *  Profiles where the existing CreateTwinWizard lives. */
  onCreateNew: () => void;
}

function matches(query: string, profile: TwinProfile): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    profile.name.toLowerCase().includes(q)
    || (profile.role ?? '').toLowerCase().includes(q)
  );
}

export function TwinPicker({ profiles, activeTwinId, onSelect, onCreateNew }: Props) {
  const { t: tFull } = useTranslation();
  const t = tFull.twin;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightIdx, setHighlightIdx] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Array<HTMLButtonElement | null>>([]);

  const ordered = useMemo(() => {
    // Active twin always pinned at the top; rest alphabetical for stability.
    const active = profiles.find((p) => p.id === activeTwinId);
    const rest = profiles
      .filter((p) => p.id !== activeTwinId)
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name));
    return active ? [active, ...rest] : rest;
  }, [profiles, activeTwinId]);

  const filtered = useMemo(() => ordered.filter((p) => matches(query, p)), [ordered, query]);

  // Reset highlight whenever the visible list changes.
  useEffect(() => {
    setHighlightIdx(0);
  }, [query, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
    return;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const el = itemsRef.current[highlightIdx];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [highlightIdx, open]);

  const activeTwin = profiles.find((p) => p.id === activeTwinId);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((idx) => Math.min(idx + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((idx) => Math.max(0, idx - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = filtered[highlightIdx];
      if (pick) {
        onSelect(pick.id);
        setOpen(false);
        setQuery('');
      }
      return;
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1 max-w-xs">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="w-full appearance-none px-3 py-1.5 pl-8 pr-7 typo-caption font-medium text-primary bg-violet-500/5 border border-violet-500/10 rounded-card cursor-pointer hover:bg-violet-500/8 focus-ring transition-colors text-left truncate"
      >
        {activeTwin ? (
          <>
            {activeTwin.name}
            {activeTwin.role && <span className="text-foreground ml-1.5">— {activeTwin.role}</span>}
          </>
        ) : (
          <span className="text-foreground">{t.selector.selectTwin}</span>
        )}
      </button>
      <Sparkles className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-violet-400/60 pointer-events-none" />
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground pointer-events-none" />

      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 z-40 rounded-card border border-primary/15 bg-card/95 backdrop-blur shadow-elevation-3 animate-fade-slide-in overflow-hidden"
          role="listbox"
          aria-label={t.selector.pickerLabel}
        >
          <div className="relative border-b border-primary/10">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKey}
              placeholder={t.selector.searchPlaceholder}
              className="w-full pl-7 pr-3 py-2 bg-transparent typo-caption text-foreground placeholder:text-foreground/50 focus:outline-none"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 typo-caption text-foreground">{t.selector.noMatches}</li>
            ) : (
              filtered.map((p, idx) => {
                const isActive = p.id === activeTwinId;
                const isHighlighted = idx === highlightIdx;
                return (
                  <li key={p.id}>
                    <button
                      ref={(el) => { itemsRef.current[idx] = el; }}
                      type="button"
                      onClick={() => {
                        onSelect(p.id);
                        setOpen(false);
                        setQuery('');
                      }}
                      onMouseEnter={() => setHighlightIdx(idx)}
                      role="option"
                      aria-selected={isActive}
                      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
                        isHighlighted ? 'bg-violet-500/10' : 'hover:bg-secondary/40'
                      }`}
                    >
                      <Sparkles className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? 'text-violet-300' : 'text-foreground'}`} />
                      <span className="flex-1 min-w-0">
                        <span className="block typo-caption text-foreground truncate">{p.name}</span>
                        {p.role && <span className="block text-[10px] text-foreground truncate">{p.role}</span>}
                      </span>
                      {isActive && <Check className="w-3.5 h-3.5 text-violet-300 flex-shrink-0" />}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          <div className="border-t border-primary/10">
            <button
              type="button"
              onClick={() => {
                onCreateNew();
                setOpen(false);
                setQuery('');
              }}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-violet-500/10 transition-colors text-violet-300"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="typo-caption font-medium">{t.selector.createTwin}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
