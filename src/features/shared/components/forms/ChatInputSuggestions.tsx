import { createPortal } from 'react-dom';
import type { ReactNode, RefObject } from 'react';
import { useAnchoredPortalPosition } from './useAnchoredPortalPosition';

/** One row of a ChatInputBar typeahead popup. */
export interface ChatInputSuggestion {
  id: string;
  /** The visible primary text (already translated by the caller). */
  label: string;
  /** Optional secondary line rendered under the label. */
  description?: string;
  /** Optional leading glyph. */
  icon?: ReactNode;
}

/** Stable option id so the field's `aria-activedescendant` can point at a row. */
export function chatSuggestionOptionId(listboxId: string, index: number): string {
  return `${listboxId}-opt-${index}`;
}

interface ChatInputSuggestionsProps {
  /** The composer pill the popup anchors to. */
  anchorRef: RefObject<HTMLElement | null>;
  /** Shared with the field's `aria-controls`. */
  listboxId: string;
  suggestions: ChatInputSuggestion[];
  activeIndex: number;
  onPick: (suggestion: ChatInputSuggestion) => void;
  onHoverIndex: (index: number) => void;
  /** Accessible name for the popup (already translated by the caller). */
  label?: string;
}

/**
 * @catalog ChatInputSuggestions — anchored combobox popup for a chat composer's
 * typeahead (@mention / #skill). Rendered for you by `ChatInputBar`'s
 * `suggestions` prop; the caller supplies the matches, the bar owns the ARIA.
 *
 * Portalled suggestion list for {@link ChatInputBar}'s typeahead slot. Anchored
 * to the composer pill and flipped above it when the composer sits near the
 * bottom of the viewport, which is where chat composers usually live.
 *
 * Deliberately NOT built on `Listbox`: that primitive owns its own open state
 * and is driven by a clickable trigger, while a combobox popup is opened by
 * what the user typed and is therefore owned by the caller.
 */
export function ChatInputSuggestions({
  anchorRef,
  listboxId,
  suggestions,
  activeIndex,
  onPick,
  onHoverIndex,
  label,
}: ChatInputSuggestionsProps) {
  const open = suggestions.length > 0;
  const pos = useAnchoredPortalPosition(anchorRef, open, { gap: 6, flip: true, maxMenuHeight: 260 });
  if (!open || !pos) return null;

  return createPortal(
    <div
      id={listboxId}
      role="listbox"
      aria-label={label}
      className="animate-fade-slide-in glass-sm max-h-[260px] overflow-y-auto scrollbar-thin rounded-xl shadow-elevation-3"
      style={{
        position: 'fixed',
        // Flipped, the popup is pinned by its BOTTOM edge just above the pill so
        // it grows upward instead of off-screen (same idiom as Listbox).
        top: pos.flipUp ? undefined : pos.top,
        bottom: pos.flipUp ? window.innerHeight - pos.top : undefined,
        left: pos.left,
        width: pos.width,
        zIndex: 9990,
      }}
    >
      {suggestions.map((item, index) => {
        const active = index === activeIndex;
        return (
          <div
            key={item.id}
            id={chatSuggestionOptionId(listboxId, index)}
            role="option"
            aria-selected={active}
            // Keep the caret in the composer: a mousedown that moves focus would
            // close the popup before the click lands.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item)}
            onMouseEnter={() => onHoverIndex(index)}
            className={`flex cursor-pointer items-center gap-2 px-3 py-2 text-left transition-colors ${
              active ? 'bg-primary/15 text-foreground' : 'text-foreground/80 hover:bg-secondary/60'
            }`}
          >
            {item.icon}
            <span className="min-w-0 flex-1">
              <span className="block truncate typo-body">{item.label}</span>
              {item.description && (
                <span className="block truncate typo-caption text-foreground">{item.description}</span>
              )}
            </span>
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
