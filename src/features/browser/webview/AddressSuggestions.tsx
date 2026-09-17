/**
 * The popup under the address bar — the listbox half of an ARIA combobox.
 *
 * IT IS DRAWN OVER THE PAGE SLOT, AND THAT IS A PROBLEM THE PAGE WINS. The
 * embedded page is a separate OS window painted ABOVE the whole React tree, so
 * an eight-line popup hanging off the address bar would be invisible from the
 * moment it crosses the slot's top edge. `AddressBar` therefore asks the route
 * to hide the page host while this is open and to show it again when it closes;
 * that is the only arrangement that works, and it is why the popup does not
 * simply live under a `z-50`.
 *
 * It owns no state. Focus never leaves the input — this is `aria-activedescendant`
 * navigation, so options are pointed AT, never focused, and a mouse click must
 * fire on `mousedown` before the input's blur can close the popup underneath it.
 */
import { useTranslation } from '@/i18n/useTranslation';
import { StatusBadge } from '@/features/shared/components/display/StatusBadge';

import type { OriginSuggestion } from './suggestOrigins';

interface AddressSuggestionsProps {
  /** Empty means "nothing matched" — the popup then carries one dead line. */
  suggestions: readonly OriginSuggestion[];
  /** Which line `aria-activedescendant` points at, or -1 for none. */
  activeIndex: number;
  listboxId: string;
  optionId: (index: number) => string;
  onHover: (index: number) => void;
  onSelect: (suggestion: OriginSuggestion) => void;
}

export default function AddressSuggestions({
  suggestions,
  activeIndex,
  listboxId,
  optionId,
  onHover,
  onSelect,
}: AddressSuggestionsProps) {
  const { t } = useTranslation();
  const v = t.browser.webview;

  return (
    <ul
      id={listboxId}
      role="listbox"
      aria-label={v.suggestions_aria}
      data-testid="webview-suggestions"
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-card border border-primary/15 bg-background shadow-elevation-3 py-1"
    >
      {suggestions.length === 0 ? (
        <li
          role="option"
          aria-selected={false}
          aria-disabled
          className="px-3 py-2 typo-caption text-foreground"
          data-testid="webview-suggestion-none"
        >
          {v.suggestions_none}
        </li>
      ) : (
        suggestions.map((suggestion, index) => (
          <li
            key={`${suggestion.site.origin}:${suggestion.target}`}
            id={optionId(index)}
            role="option"
            aria-selected={index === activeIndex}
            aria-disabled={!suggestion.selectable || undefined}
            onMouseEnter={() => onHover(index)}
            // mousedown, not click: the input's blur would unmount this row first.
            onMouseDown={(event) => {
              event.preventDefault();
              if (suggestion.selectable) onSelect(suggestion);
            }}
            data-testid={`webview-suggestion-${index}`}
            className={[
              'px-3 py-1.5 flex items-center gap-2 min-w-0',
              suggestion.selectable ? 'cursor-pointer' : 'cursor-not-allowed opacity-60',
              index === activeIndex ? 'bg-primary/10' : '',
            ].join(' ')}
          >
            <span className="typo-caption font-mono text-foreground truncate">
              {suggestion.target}
            </span>
            {suggestion.site.label ? (
              <span className="typo-caption text-foreground truncate">
                {suggestion.site.label}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1 shrink-0">
              {suggestion.pattern ? (
                <StatusBadge accent="indigo" size="sm">
                  {t.browser.whitelist.pattern_chip}
                </StatusBadge>
              ) : null}
              {suggestion.selectable ? null : (
                <StatusBadge variant="neutral" size="sm">
                  {v.suggestion_paused}
                </StatusBadge>
              )}
            </span>
          </li>
        ))
      )}
    </ul>
  );
}
