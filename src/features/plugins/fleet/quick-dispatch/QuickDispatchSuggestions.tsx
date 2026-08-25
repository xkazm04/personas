import { useEffect, useRef } from 'react';

/**
 * Suggestion panel for the Quick Dispatch typeaheads (`@` projects, `/`
 * skills). Rendered INSIDE the overlay card above the input, styled after the
 * companion `SlashPalette`. Keyboard navigation lives in the overlay (the
 * input's key handler drives `activeIndex`); this panel only paints, keeps the
 * active row scrolled into view, and carries the listbox half of the combobox
 * ARIA contract (the overlay stamps the combobox half onto the textarea).
 */

export interface QuickDispatchSuggestion {
  id: string;
  label: string;
  description?: string | null;
}

interface Props {
  listboxId: string;
  items: QuickDispatchSuggestion[];
  activeIndex: number;
  /** Rendered instead of rows — e.g. "pick a @project first" or "no matches". */
  hint?: string | null;
  onPick: (item: QuickDispatchSuggestion) => void;
  onHoverIndex: (idx: number) => void;
}

/** Stable DOM id for a suggestion row — the `aria-activedescendant` target. */
export function quickDispatchOptionId(listboxId: string, idx: number): string {
  return `${listboxId}-option-${idx}`;
}

export function QuickDispatchSuggestions({
  listboxId,
  items,
  activeIndex,
  hint,
  onPick,
  onHoverIndex,
}: Props) {
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  // Same idiom as SlashPalette: keep the arrow-keyed row in view, guarded for
  // environments without scrollIntoView (jsdom).
  useEffect(() => {
    const el = itemRefs.current[activeIndex];
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  if (hint) {
    return (
      <div
        className="rounded-card border border-foreground/10 bg-secondary/95 backdrop-blur-sm shadow-elevation-3 px-3 py-2 typo-caption text-foreground"
        data-testid="quick-dispatch-suggestions-hint"
      >
        {hint}
      </div>
    );
  }

  if (items.length === 0) return null;

  return (
    <div
      className="rounded-card border border-foreground/10 bg-secondary/95 backdrop-blur-sm shadow-elevation-3 overflow-hidden"
      data-testid="quick-dispatch-suggestions"
    >
      <ul id={listboxId} role="listbox" className="max-h-56 overflow-y-auto scrollbar-thin">
        {items.map((item, idx) => {
          const active = idx === Math.min(activeIndex, items.length - 1);
          return (
            <li
              key={item.id}
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              id={quickDispatchOptionId(listboxId, idx)}
              role="option"
              aria-selected={active}
              // Mouse-down (not click) so the textarea never loses focus.
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
              onMouseEnter={() => onHoverIndex(idx)}
              className={`px-3 py-1.5 cursor-pointer transition-colors ${
                active ? 'bg-primary/10' : 'hover:bg-foreground/[0.04]'
              }`}
              data-testid="quick-dispatch-suggestion-item"
              data-active={active ? 'true' : 'false'}
            >
              <span className="typo-caption text-foreground block truncate">
                {item.label}
              </span>
              {item.description && (
                <span className="typo-caption text-foreground block truncate opacity-90">
                  {item.description}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
