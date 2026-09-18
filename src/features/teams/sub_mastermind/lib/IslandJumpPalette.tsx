/**
 * The '/' jump palette: type an island's name, land on it.
 *
 * CanvasShell already had one tab stop, spatial arrows, Home, Enter and
 * Shift+F10 - everything except the one navigation that scales. This is the
 * search half; the shell hands `onJump` the same `focusSlug` the arrow keys
 * use, so a jump focuses AND pans exactly as a cursor move does.
 *
 * A query that matches nothing calls `onMiss` rather than closing silently:
 * the shell routes it into the live region, so a miss is spoken instead of
 * looking like a dead keypress.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { matchIslands, type SearchableIsland } from './islandSearch';

export function IslandJumpPalette({
  islands,
  onJump,
  onMiss,
  onClose,
}: {
  islands: readonly SearchableIsland[];
  onJump: (slug: string) => void;
  onMiss: (query: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => matchIslands(islands, query), [islands, query]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  // A narrowing query can strand the cursor past the end of the list.
  useEffect(() => { setCursor(0); }, [query]);

  const commit = () => {
    const picked = results[cursor] ?? results[0];
    if (!picked) {
      onMiss(query.trim());
      return;
    }
    onJump(picked.slug);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
    if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (results.length === 0 ? 0 : (c - 1 + results.length) % results.length));
    }
  };

  return (
    <div
      className="absolute left-1/2 top-16 -translate-x-1/2 z-20 w-80 rounded-modal border border-primary/20 bg-background/95 shadow-elevation-3 overflow-hidden"
      data-testid="mm-jump-palette"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Search className="w-3.5 h-3.5 text-foreground opacity-70" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t.mastermind.jump_placeholder}
          aria-label={t.mastermind.jump_label}
          data-testid="mm-jump-input"
          className="flex-1 bg-transparent typo-body text-foreground placeholder:text-foreground/50 focus:outline-none"
        />
      </div>

      {results.length === 0 ? (
        <p className="px-3 py-2 typo-caption text-foreground opacity-70" data-testid="mm-jump-empty">
          {t.mastermind.jump_no_match}
        </p>
      ) : (
        <ul role="listbox" aria-label={t.mastermind.jump_label} className="max-h-64 overflow-y-auto">
          {results.map((island, i) => (
            <li key={island.slug}>
              <button
                type="button"
                role="option"
                aria-selected={i === cursor}
                onMouseDown={(e) => { e.preventDefault(); onJump(island.slug); onClose(); }}
                onMouseEnter={() => setCursor(i)}
                data-testid={`mm-jump-option-${island.slug}`}
                className={`w-full text-left px-3 py-1.5 typo-body truncate transition-colors ${
                  i === cursor ? 'bg-primary/15 text-foreground' : 'text-foreground hover:bg-secondary/40'
                }`}
              >
                {island.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
