import { useState, useCallback, useMemo } from 'react';

export interface QueryChip {
  type: 'category';
  value: string;
  label: string;
}

export interface UseStructuredQueryReturn {
  inputValue: string;
  setInputValue: (v: string) => void;
  chips: QueryChip[];
  addChip: (chip: QueryChip) => void;
  removeChip: (index: number) => void;
  clearAll: () => void;
  /** Non-null when user is typing a recognized prefix (e.g. "category:") */
  autocompletePrefix: string | null;
  /** The partial value after the prefix for filtering suggestions */
  autocompleteQuery: string;
  /** Plain keyword text (everything not consumed by chips/prefixes) */
  keywordText: string;
}

const PREFIXES = ['category:'] as const;

/**
 * Parses structured query tokens from the search input.
 * Supports `category:value` syntax that commits as chips.
 */
export function useStructuredQuery(
  onCategoryFilterChange: (categories: string[]) => void,
  onSearchChange: (keyword: string) => void,
): UseStructuredQueryReturn {
  const [inputValue, setInputValueRaw] = useState('');
  const [chips, setChips] = useState<QueryChip[]>([]);

  // Detect if the user is typing a prefix like "category:"
  const { autocompletePrefix, autocompleteQuery, keywordText } = useMemo(() => {
    // Check if the last "word" being typed matches a prefix
    const words = inputValue.split(/\s+/);
    const lastWord = words[words.length - 1] ?? '';

    for (const prefix of PREFIXES) {
      if (lastWord.toLowerCase().startsWith(prefix)) {
        const query = lastWord.slice(prefix.length);
        const keyword = words.slice(0, -1).join(' ');
        return { autocompletePrefix: prefix, autocompleteQuery: query, keywordText: keyword };
      }
      // Also detect partial prefix typing (e.g. "categ")
      if (prefix.startsWith(lastWord.toLowerCase()) && lastWord.length >= 3) {
        const keyword = words.slice(0, -1).join(' ');
        return { autocompletePrefix: lastWord.toLowerCase(), autocompleteQuery: '', keywordText: keyword };
      }
    }

    return { autocompletePrefix: null, autocompleteQuery: '', keywordText: inputValue };
  }, [inputValue]);

  // Sync keyword text to parent search
  const setInputValue = useCallback((value: string) => {
    setInputValueRaw(value);

    // Extract keyword text (everything except active prefix typing)
    const words = value.split(/\s+/);
    const lastWord = words[words.length - 1] ?? '';
    const isTypingPrefix = PREFIXES.some(
      (p) => lastWord.toLowerCase().startsWith(p) || (p.startsWith(lastWord.toLowerCase()) && lastWord.length >= 3),
    );

    if (isTypingPrefix) {
      onSearchChange(words.slice(0, -1).join(' '));
    } else {
      onSearchChange(value);
    }
  }, [onSearchChange]);

  const addChip = useCallback((chip: QueryChip) => {
    setChips((prev) => {
      // Don't add duplicate
      if (prev.some((c) => c.type === chip.type && c.value === chip.value)) return prev;

      const next = [...prev, chip];
      // Sync to parent
      if (chip.type === 'category') {
        onCategoryFilterChange(next.filter((c) => c.type === 'category').map((c) => c.value));
      }
      return next;
    });

    // Remove the prefix text from input
    setInputValueRaw((prev) => {
      const words = prev.split(/\s+/);
      const lastWord = words[words.length - 1] ?? '';
      const isPrefix = PREFIXES.some(
        (p) => lastWord.toLowerCase().startsWith(p) || (p.startsWith(lastWord.toLowerCase()) && lastWord.length >= 3),
      );
      if (isPrefix) {
        const cleaned = words.slice(0, -1).join(' ');
        onSearchChange(cleaned);
        return cleaned;
      }
      return prev;
    });
  }, [onCategoryFilterChange, onSearchChange]);

  const removeChip = useCallback((index: number) => {
    setChips((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);

      if (removed?.type === 'category') {
        onCategoryFilterChange(next.filter((c) => c.type === 'category').map((c) => c.value));
      }
      return next;
    });
  }, [onCategoryFilterChange]);

  const clearAll = useCallback(() => {
    setChips([]);
    setInputValueRaw('');
    onCategoryFilterChange([]);
    onSearchChange('');
  }, [onCategoryFilterChange, onSearchChange]);

  // Also handle external category filter changes (e.g. from explore view)
  // by syncing chips when category filter is set externally
  // This is intentionally one-way: chips -> filters. External filter sets
  // should go through addChip.

  return {
    inputValue,
    setInputValue,
    chips,
    addChip,
    removeChip,
    clearAll,
    autocompletePrefix,
    autocompleteQuery,
    keywordText,
  };
}
