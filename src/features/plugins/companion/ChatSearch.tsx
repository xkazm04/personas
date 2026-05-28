/**
 * ChatSearch — in-transcript find. Toggled from the panel header; renders a
 * fixed-height search bar at the top of the transcript area and, once a query
 * is entered, an overlay that covers the transcript with the matching messages
 * (rendered as read-only bubbles). Because it's a self-contained overlay it
 * needs no changes to the main transcript render path.
 *
 * State lives in the companion store (`chatSearchOpen` / `chatSearchQuery`) so
 * the header toggle and this overlay stay decoupled. Closing clears the query.
 */
import { useEffect, useMemo, useRef } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BrainKind } from '@/api/companion';
import { useCompanionStore } from './companionStore';
import { Bubble } from './Bubble';

const BAR_H = 'h-11';

export function ChatSearch({
  messages,
  onOpenInBrain,
}: {
  messages: ReturnType<typeof useCompanionStore.getState>['messages'];
  onOpenInBrain?: (kind: BrainKind, id: string) => void;
}) {
  const { t, tx } = useTranslation();
  const open = useCompanionStore((s) => s.chatSearchOpen);
  const query = useCompanionStore((s) => s.chatSearchQuery);
  const setQuery = useCompanionStore((s) => s.setChatSearchQuery);
  const setOpen = useCompanionStore((s) => s.setChatSearchOpen);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    return messages.filter(
      (m) =>
        (m.role === 'user' || m.role === 'assistant') &&
        m.content.toLowerCase().includes(q),
    );
  }, [messages, q]);

  if (!open) return null;

  return (
    <>
      <div
        className={`${BAR_H} shrink-0 flex items-center gap-2 px-3 border-b border-foreground/10 bg-secondary/95 backdrop-blur-sm`}
        data-testid="companion-search-bar"
      >
        <Search className="w-4 h-4 text-primary shrink-0" aria-hidden />
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setOpen(false);
            }
          }}
          placeholder={t.plugins.companion.search_placeholder}
          aria-label={t.plugins.companion.search_placeholder}
          className="flex-1 min-w-0 bg-transparent border-0 outline-none typo-body text-foreground placeholder:text-foreground/40"
          data-testid="companion-search-input"
        />
        {q && (
          <span className="shrink-0 typo-caption text-foreground tabular-nums">
            {tx(t.plugins.companion.search_results, { count: results.length })}
          </span>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t.common.close}
          className="shrink-0 p-1.5 rounded-interactive text-foreground hover:bg-foreground/5 transition-colors focus-ring"
          data-testid="companion-search-close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {q && (
        <div
          className="absolute inset-x-0 top-11 bottom-0 z-20 overflow-y-auto bg-secondary/98 backdrop-blur-sm px-5 py-4 space-y-3 scrollbar-thin companion-scroll"
          data-testid="companion-search-results"
        >
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Search className="w-6 h-6 text-primary/50" aria-hidden />
              <p className="typo-body text-foreground">
                {t.plugins.companion.search_no_results}
              </p>
            </div>
          ) : (
            results.map((m, i) => (
              <Bubble
                key={m.id}
                role={m.role}
                index={i}
                createdAt={m.createdAt}
                onOpenInBrain={onOpenInBrain}
              >
                {m.content}
              </Bubble>
            ))
          )}
        </div>
      )}
    </>
  );
}
