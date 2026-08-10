// Fabric omnibox — the retrieval half of the topic graph. Flying is the right
// verb for exploring the sky and the wrong one for finding a pattern you can
// already name, so this searches every grain at once (area → cluster → facet →
// pattern) and hands the chosen match back to the host, which owns all camera
// and modal policy. Ranking + the index live in `graphModel` as pure functions.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';
import { searchFabric, type FabricIndex, type FabricMatch } from './graphModel';

const LIST_ID = 'fabric-omnibox-list';

export function FabricSearch({
  index,
  onSelect,
}: {
  index: FabricIndex;
  onSelect: (match: FabricMatch) => void;
}) {
  const { t } = useTranslation();
  const w = t.plugins.dev_tools.workspaces;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const matches = useMemo(() => searchFabric(index, query), [index, query]);

  // A new query starts at the top of its own result list.
  useEffect(() => setActive(0), [query]);

  // Clicking anywhere else dismisses the dropdown but keeps the query — the
  // user may want to re-open the same results after a look at the canvas.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [open]);

  const commit = (match: FabricMatch | undefined) => {
    if (!match) return;
    onSelect(match);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      // Esc closes the dropdown ONLY — the host's window-level Esc walks the
      // camera back out, and a search dismissal must not also fly home.
      if (open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (matches.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % matches.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i - 1 + matches.length) % matches.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(matches[active]);
    }
  };

  const showList = open && query.trim().length > 0;

  return (
    <div ref={rootRef} className="relative w-[260px] max-w-[45%]">
      <Search
        className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-foreground/40"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={w.graph_search_placeholder}
        aria-label={w.graph_search_aria}
        role="combobox"
        aria-expanded={showList}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={showList && matches.length > 0 ? `${LIST_ID}-${active}` : undefined}
        className={`${INPUT_FIELD} pl-7 pr-7 py-1 typo-caption`}
      />
      {query.length > 0 && (
        <button
          type="button"
          onClick={() => {
            setQuery('');
            inputRef.current?.focus();
          }}
          aria-label={t.common.clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-foreground/40 hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" />
        </button>
      )}

      {showList && (
        <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-card border border-border/70 bg-background/95 backdrop-blur-sm shadow-elevation-3 overflow-hidden animate-fade-in">
          {matches.length === 0 ? (
            <p className="typo-caption text-foreground/50 px-2.5 py-2">{t.common.no_results}</p>
          ) : (
            <ul id={LIST_ID} role="listbox" aria-label={w.graph_search_aria} className="max-h-72 overflow-y-auto py-1">
              {matches.map((m, i) => (
                <li
                  key={m.key}
                  id={`${LIST_ID}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onPointerEnter={() => setActive(i)}
                  onClick={() => commit(m)}
                  className={`flex items-baseline gap-2 px-2.5 py-1.5 cursor-pointer transition-colors ${
                    i === active ? 'bg-primary/10' : 'hover:bg-secondary/50'
                  }`}
                >
                  <span className="typo-caption text-foreground truncate flex-1">{m.label}</span>
                  <span className="typo-caption text-foreground/45 truncate max-w-[45%]">{m.path}</span>
                  {m.kind !== 'pattern' && (
                    <span className="typo-caption text-foreground/40 tabular-nums flex-shrink-0">{m.count}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
