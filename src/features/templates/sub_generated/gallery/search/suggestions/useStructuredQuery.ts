import { useState, useCallback, useMemo, useEffect, useRef } from 'react';

export type ChipType = 'category' | 'difficulty' | 'setup';

export interface QueryChip {
  type: ChipType;
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

const PREFIXES = ['category:', 'difficulty:', 'setup:'] as const;

export interface StructuredQueryCallbacks {
  onCategoryFilterChange: (categories: string[]) => void;
  onSearchChange: (keyword: string) => void;
  onDifficultyFilterChange?: (values: string[]) => void;
  onSetupFilterChange?: (values: string[]) => void;
}

/**
 * Parses structured query tokens from the search input.
 * Supports `category:value`, `difficulty:value`, and `setup:value` syntax that commits as chips.
 */
// Module-level cache to persist input across component remounts
let _cachedInput = '';
let _cachedChips: QueryChip[] = [];

export function useStructuredQuery(
  onCategoryFilterChange: (categories: string[]) => void,
  onSearchChange: (keyword: string) => void,
  callbacks?: Pick<StructuredQueryCallbacks, 'onDifficultyFilterChange' | 'onSetupFilterChange'>,
): UseStructuredQueryReturn {
  const [inputValue, setInputValueRaw] = useState(_cachedInput);
  const [chips, setChips] = useState<QueryChip[]>(_cachedChips);

  // On mount, if the module-level cache has a value (user switched modules and
  // returned), rehydrate the parent filter state so the gallery actually filters
  // instead of just showing the populated input with an unfiltered result set.
  const didHydrateRef = useRef(false);
  useEffect(() => {
    if (didHydrateRef.current) return;
    didHydrateRef.current = true;
    if (_cachedInput) onSearchChange(_cachedInput);
    if (_cachedChips.length > 0) {
      const cats = _cachedChips.filter((c) => c.type === 'category').map((c) => c.value);
      const diffs = _cachedChips.filter((c) => c.type === 'difficulty').map((c) => c.value);
      const setups = _cachedChips.filter((c) => c.type === 'setup').map((c) => c.value);
      if (cats.length > 0) onCategoryFilterChange(cats);
      if (diffs.length > 0) callbacks?.onDifficultyFilterChange?.(diffs);
      if (setups.length > 0) callbacks?.onSetupFilterChange?.(setups);
    }
  }, []);

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
    _cachedInput = value;
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

  const syncChipFilters = useCallback((next: QueryChip[], changedType: ChipType) => {
    if (changedType === 'category') {
      onCategoryFilterChange(next.filter((c) => c.type === 'category').map((c) => c.value));
    } else if (changedType === 'difficulty') {
      callbacks?.onDifficultyFilterChange?.(next.filter((c) => c.type === 'difficulty').map((c) => c.value));
    } else if (changedType === 'setup') {
      callbacks?.onSetupFilterChange?.(next.filter((c) => c.type === 'setup').map((c) => c.value));
    }
  }, [onCategoryFilterChange, callbacks]);

  const addChip = useCallback((chip: QueryChip) => {
    setChips((prev) => {
      if (prev.some((c) => c.type === chip.type && c.value === chip.value)) return prev;
      const next = [...prev, chip];
      _cachedChips = next;
      syncChipFilters(next, chip.type);
      return next;
    });

    setInputValueRaw((prev) => {
      const words = prev.split(/\s+/);
      const lastWord = words[words.length - 1] ?? '';
      const isPrefix = PREFIXES.some(
        (p) => lastWord.toLowerCase().startsWith(p) || (p.startsWith(lastWord.toLowerCase()) && lastWord.length >= 3),
      );
      if (isPrefix) {
        const cleaned = words.slice(0, -1).join(' ');
        _cachedInput = cleaned;
        onSearchChange(cleaned);
        return cleaned;
      }
      return prev;
    });
  }, [syncChipFilters, onSearchChange]);

  const removeChip = useCallback((index: number) => {
    setChips((prev) => {
      const removed = prev[index];
      const next = prev.filter((_, i) => i !== index);
      _cachedChips = next;
      if (removed) syncChipFilters(next, removed.type);
      return next;
    });
  }, [syncChipFilters]);

  const clearAll = useCallback(() => {
    _cachedInput = '';
    _cachedChips = [];
    setChips([]);
    setInputValueRaw('');
    onCategoryFilterChange([]);
    callbacks?.onDifficultyFilterChange?.([]);
    callbacks?.onSetupFilterChange?.([]);
    onSearchChange('');
  }, [onCategoryFilterChange, callbacks, onSearchChange]);

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
