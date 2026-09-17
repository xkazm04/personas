/**
 * The combobox half of the address bar: which lines to offer, which one the
 * keyboard is pointing at, and when the popup is open at all.
 *
 * Lives beside `AddressBar` rather than inside it so the component stays a
 * render and this stays testable — and so the file that has to explain the
 * page-host visibility dance does not also have to explain arrow keys.
 *
 * ARROWING SKIPS PAUSED ROWS. They are rendered (the operator asked for that
 * site and should be told it is listed) and they carry `aria-disabled`, but the
 * cursor never lands on one, because an Enter that does nothing is a worse
 * answer than a row the cursor passes over. With no selectable row at all the
 * index stays -1 and Enter falls through to the plain navigate, which the gate
 * refuses inline exactly as it always did.
 */
import { useCallback, useId, useMemo, useState } from 'react';

import type { BrowserSite } from '../types';
import { suggestOrigins, type OriginSuggestion } from './suggestOrigins';

export interface AddressSuggestionsState {
  open: boolean;
  suggestions: OriginSuggestion[];
  activeIndex: number;
  listboxId: string;
  optionId: (index: number) => string;
  activeOptionId: string | undefined;
  /** Point at a line (mouse hover). Ignored for a paused row. */
  hover: (index: number) => void;
  /** The operator typed — re-open a popup an Escape had dismissed. */
  noteTyping: () => void;
  /** Close and stay closed until the next keystroke. */
  dismiss: () => void;
  /** ArrowUp / ArrowDown / Escape. Returns the line Enter should take, if any. */
  move: (direction: 1 | -1) => void;
  /** What Enter should act on, or null when Enter means "navigate to the text". */
  chosen: () => OriginSuggestion | null;
}

export function useAddressSuggestions(
  value: string,
  sites: readonly BrowserSite[],
): AddressSuggestionsState {
  const uid = useId();
  const [dismissed, setDismissed] = useState(true);
  const [activeIndex, setActiveIndex] = useState(-1);

  const suggestions = useMemo(() => suggestOrigins(value, sites), [value, sites]);
  const open = !dismissed && value.trim().length > 0;

  const optionId = useCallback((index: number) => `${uid}-option-${index}`, [uid]);

  const move = useCallback(
    (direction: 1 | -1) => {
      setDismissed(false);
      setActiveIndex((current) => {
        const count = suggestions.length;
        if (count === 0) return -1;
        // Walk at most one full lap; a list of only paused rows has no landing spot.
        let next = current;
        for (let step = 0; step < count; step += 1) {
          next += direction;
          if (next < 0) next = count - 1;
          if (next >= count) next = 0;
          if (suggestions[next]?.selectable) return next;
        }
        return -1;
      });
    },
    [suggestions],
  );

  const hover = useCallback(
    (index: number) => {
      if (suggestions[index]?.selectable) setActiveIndex(index);
    },
    [suggestions],
  );

  const noteTyping = useCallback(() => {
    setDismissed(false);
    setActiveIndex(-1);
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setActiveIndex(-1);
  }, []);

  const chosen = useCallback(() => {
    if (!open || activeIndex < 0) return null;
    const suggestion = suggestions[activeIndex];
    return suggestion?.selectable ? suggestion : null;
  }, [open, activeIndex, suggestions]);

  return {
    open,
    suggestions,
    activeIndex: open ? activeIndex : -1,
    listboxId: `${uid}-listbox`,
    optionId,
    activeOptionId: open && activeIndex >= 0 ? optionId(activeIndex) : undefined,
    hover,
    noteTyping,
    dismiss,
    move,
    chosen,
  };
}
