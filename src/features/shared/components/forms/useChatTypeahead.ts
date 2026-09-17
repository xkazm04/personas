import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { chatSuggestionOptionId, type ChatInputSuggestion } from './ChatInputSuggestions';

/** ARIA the composer field wears while a suggestion list is open. */
export interface ChatComboboxProps {
  role: 'combobox';
  'aria-expanded': true;
  'aria-controls': string;
  'aria-autocomplete': 'list';
  'aria-activedescendant': string | undefined;
}

export interface ChatTypeahead {
  /** True while a non-empty suggestion list is showing. */
  open: boolean;
  listboxId: string;
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** Spread onto the input/textarea; `undefined` when the list is closed, so a
   *  composer with no suggestions carries no combobox attributes at all. */
  comboboxProps: ChatComboboxProps | undefined;
  /** Returns true when the key was consumed by the typeahead, in which case the
   *  composer must not treat it as submit/newline. */
  handleKeyDown: (e: React.KeyboardEvent) => boolean;
}

/**
 * Owns the combobox half of {@link ChatInputBar}'s typeahead contract: the
 * highlighted row, the ARIA the field must wear, and Arrow/Enter/Escape.
 *
 * Callers stay in charge of *what* is suggested (they own the token parsing and
 * the list); the composer owns the wiring, so no consumer has to reach into the
 * DOM to stamp `role="combobox"` onto a textarea it does not render.
 */
export function useChatTypeahead(
  suggestions: ChatInputSuggestion[] | undefined,
  onSelectSuggestion: ((suggestion: ChatInputSuggestion) => void) | undefined,
  onDismissSuggestions: (() => void) | undefined,
): ChatTypeahead {
  const listboxId = useId();
  const [activeIndex, setActiveIndex] = useState(0);

  const items = useMemo(() => suggestions ?? [], [suggestions]);
  const count = items.length;
  const open = count > 0;
  // Clamp rather than trust state: the list can shrink between renders.
  const index = count > 0 ? Math.min(activeIndex, count - 1) : 0;
  const firstId = items[0]?.id;

  // A new list (different length or different head) starts at the top match.
  useEffect(() => {
    setActiveIndex(0);
  }, [count, firstId]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent): boolean => {
      if (!open) return false;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => (Math.min(i, count - 1) + 1) % count);
        return true;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => (Math.min(i, count - 1) - 1 + count) % count);
        return true;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        // Enter picks while the list is open; it never sends a draft that still
        // ends in the half-typed token that opened the list.
        e.preventDefault();
        const pick = items[index];
        if (pick) onSelectSuggestion?.(pick);
        return true;
      }
      if (e.key === 'Escape' && onDismissSuggestions) {
        e.preventDefault();
        onDismissSuggestions();
        return true;
      }
      return false;
    },
    [open, count, index, items, onSelectSuggestion, onDismissSuggestions],
  );

  return {
    open,
    listboxId,
    activeIndex: index,
    setActiveIndex,
    comboboxProps: open
      ? {
          role: 'combobox',
          'aria-expanded': true,
          'aria-controls': listboxId,
          'aria-autocomplete': 'list',
          'aria-activedescendant': chatSuggestionOptionId(listboxId, index),
        }
      : undefined,
    handleKeyDown,
  };
}
