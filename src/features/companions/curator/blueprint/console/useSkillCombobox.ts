/**
 * The skill field, as an ARIA combobox over the registry's own skill list.
 *
 * Neither the ranking nor the listbox is re-authored here. The ranking is
 * `filterQuickDispatchSkills`, the Fleet dock's own - it was widened to any
 * `{ name, description }` rather than copied, so one matcher serves both
 * surfaces. The listbox is `QuickDispatchSuggestions`, which owns the option
 * ids, `role="option"`, `aria-selected` and the scroll-into-view. What is new
 * is the COMBOBOX half, and it is declarative here because this field is a
 * plain `<input>` this module renders - the dock has to stamp the same
 * attributes imperatively only because it does not own its textarea.
 */
import { useCallback, useMemo, useState, type KeyboardEvent } from 'react';

import {
  quickDispatchOptionId,
  type QuickDispatchSuggestion,
} from '@/features/plugins/fleet/quick-dispatch/QuickDispatchSuggestions';
import { filterQuickDispatchSkills } from '@/features/plugins/fleet/quick-dispatch/quickDispatchTypeahead';
import type { CuratorSkill } from '@/lib/bindings/CuratorSkill';

export interface SkillCombobox {
  query: string;
  setQuery: (value: string) => void;
  /** The skill the operator settled on, or null while they are still looking. */
  selected: CuratorSkill | null;
  clear: () => void;
  pick: (item: QuickDispatchSuggestion) => void;
  matches: CuratorSkill[];
  suggestions: QuickDispatchSuggestion[];
  activeIndex: number;
  setActiveIndex: (index: number) => void;
  /** True while the listbox is showing options. */
  expanded: boolean;
  /** Focus handlers for the field - the listbox only opens while it has focus. */
  onFocus: () => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  /** The combobox half of the ARIA contract, spread onto the input. */
  comboProps: {
    role: 'combobox';
    'aria-expanded': boolean;
    'aria-controls': string;
    'aria-autocomplete': 'list';
    'aria-activedescendant'?: string;
  };
}

export function useSkillCombobox(
  skills: CuratorSkill[] | null,
  listboxId: string,
): SkillCombobox {
  const [query, setQueryState] = useState('');
  const [selected, setSelected] = useState<CuratorSkill | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  // The listbox opens on FOCUS, not on having candidates. An empty query
  // ranks every skill, so a panel keyed on `matches.length` alone would sit
  // open over the ledger from the moment the page painted.
  const [focused, setFocused] = useState(false);

  const matches = useMemo(
    () => (selected ? [] : filterQuickDispatchSkills(skills ?? [], query)),
    [skills, query, selected],
  );

  // `description` is the skill file's own one-liner and may be null; the
  // listbox renders the lane instead when it is, so a row is never blank.
  const suggestions = useMemo<QuickDispatchSuggestion[]>(
    () => matches.map((s) => ({ id: s.path, label: s.name, description: s.description })),
    [matches],
  );

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setSelected(null);
    setActiveIndex(0);
  }, []);

  const clear = useCallback(() => {
    setSelected(null);
    setQueryState('');
    setActiveIndex(0);
    setFocused(false);
  }, []);

  const pick = useCallback(
    (item: QuickDispatchSuggestion) => {
      const skill = matches.find((s) => s.path === item.id);
      if (!skill) return;
      setSelected(skill);
      setQueryState(skill.name);
      setActiveIndex(0);
    },
    [matches],
  );

  const expanded = focused && suggestions.length > 0;

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (!expanded) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((i) => (i + 1) % suggestions.length);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
      } else if (event.key === 'Enter') {
        // While the list is open Enter PICKS. It never files the request - a
        // half-typed skill name is not a skill, and filing one would dispatch
        // against a name the catalog never matched.
        event.preventDefault();
        const item = suggestions[Math.min(activeIndex, suggestions.length - 1)];
        if (item) pick(item);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setQueryState('');
      }
    },
    [expanded, suggestions, activeIndex, pick],
  );

  const onFocus = useCallback(() => setFocused(true), []);
  // A suggestion is picked on mousedown with the default prevented, so the
  // field never loses focus to a click on the list: blur here means the
  // operator really left the field.
  const onBlur = useCallback(() => setFocused(false), []);

  return {
    query,
    setQuery,
    selected,
    clear,
    pick,
    matches,
    suggestions,
    activeIndex,
    setActiveIndex,
    expanded,
    onFocus,
    onBlur,
    onKeyDown,
    comboProps: {
      role: 'combobox',
      'aria-expanded': expanded,
      'aria-controls': listboxId,
      'aria-autocomplete': 'list',
      ...(expanded
        ? {
            'aria-activedescendant': quickDispatchOptionId(
              listboxId,
              Math.min(activeIndex, suggestions.length - 1),
            ),
          }
        : {}),
    },
  };
}
