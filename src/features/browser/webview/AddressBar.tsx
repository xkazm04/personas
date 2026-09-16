/**
 * Back / forward / address / go, for the tab Rust says is focused.
 *
 * A REFUSED NAVIGATION IS NOT A TOAST. Most attempts to leave the whitelist
 * are ordinary — a link on the page, a redirect, a typo — and a toast per
 * refusal would be a storm that teaches the operator to ignore it. The refusal
 * renders inline under the field, resolved through the error registry, and it
 * clears on the next keystroke. Toasts stay for things the operator did not
 * cause.
 *
 * THE FIELD IS A COMBOBOX OVER THE WHITELIST. Typing offers the rows the gate
 * would accept, ranked (`suggestOrigins`), with a pattern row expanded to a
 * concrete origin. The popup hangs BELOW the field and therefore over the page
 * slot, where a separate OS window is painted above everything React draws — so
 * opening it tells the route to hide the page host, and closing it tells the
 * route to show it again. That is reported upward through
 * `onSuggestionsOpenChange` rather than called from here, because the route is
 * the thing that owns the host's visibility over its whole lifetime.
 */
import { useEffect } from 'react';
import { ArrowLeft, ArrowRight, CornerDownLeft } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { INPUT_FIELD } from '@/lib/utils/designTokens';

import type { BrowserSite, BrowserTab } from '../types';
import AddressSuggestions from './AddressSuggestions';
import { useAddressSuggestions } from './useAddressSuggestions';

interface AddressBarProps {
  tab: BrowserTab | null;
  value: string;
  refusal: string | null;
  /** The whitelist, as the store holds it — the only source of suggestions. */
  sites: readonly BrowserSite[];
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** A suggestion was picked: fill the field AND navigate, in one act. */
  onSelectSuggestion: (origin: string) => void;
  /** The popup is open (true) or closed (false) — the route hides the page host while it is. */
  onSuggestionsOpenChange: (open: boolean) => void;
  onBack: () => void;
  onForward: () => void;
}

export default function AddressBar({
  tab,
  value,
  refusal,
  sites,
  onChange,
  onSubmit,
  onSelectSuggestion,
  onSuggestionsOpenChange,
  onBack,
  onForward,
}: AddressBarProps) {
  const { t } = useTranslation();
  const v = t.browser.webview;
  const box = useAddressSuggestions(value, sites);

  useEffect(() => {
    onSuggestionsOpenChange(box.open);
  }, [box.open, onSuggestionsOpenChange]);

  // Unmounting with the popup open would leave the page host hidden forever.
  useEffect(() => () => onSuggestionsOpenChange(false), [onSuggestionsOpenChange]);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onBack}
          disabled={!tab?.can_go_back}
          aria-label={v.back}
          data-testid="webview-back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onForward}
          disabled={!tab?.can_go_forward}
          aria-label={v.forward}
          data-testid="webview-forward"
        >
          <ArrowRight className="w-4 h-4" />
        </Button>
        <div className="relative flex-1 min-w-0">
          <input
            type="text"
            role="combobox"
            aria-expanded={box.open}
            aria-controls={box.listboxId}
            aria-activedescendant={box.activeOptionId}
            aria-autocomplete="list"
            value={value}
            onChange={(e) => {
              box.noteTyping();
              onChange(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                box.move(e.key === 'ArrowDown' ? 1 : -1);
                return;
              }
              if (e.key === 'Escape') {
                if (box.open) e.stopPropagation();
                box.dismiss();
                return;
              }
              if (e.key !== 'Enter') return;
              const picked = box.chosen();
              box.dismiss();
              if (picked) onSelectSuggestion(picked.target);
              else onSubmit();
            }}
            onBlur={box.dismiss}
            aria-label={v.address_label}
            aria-invalid={!!refusal}
            aria-describedby={refusal ? 'webview-address-refusal' : undefined}
            placeholder={v.address_placeholder}
            className={`${INPUT_FIELD} font-mono`}
            data-testid="webview-address"
          />
          {box.open && (
            <AddressSuggestions
              suggestions={box.suggestions}
              activeIndex={box.activeIndex}
              listboxId={box.listboxId}
              optionId={box.optionId}
              onHover={box.hover}
              onSelect={(suggestion) => {
                box.dismiss();
                onSelectSuggestion(suggestion.target);
              }}
            />
          )}
        </div>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSubmit}
          aria-label={v.go}
          data-testid="webview-go"
        >
          <CornerDownLeft className="w-4 h-4" />
        </Button>
      </div>
      {/* The region is mounted EMPTY and stays mounted. A live region that
          appears already carrying its text enters the accessibility tree in the
          same commit as the text, so there is no change for a screen reader to
          observe and the announcement never fires. */}
      <p
        id="webview-address-refusal"
        role="status"
        className={`typo-caption text-amber-400 ${refusal ? '' : 'sr-only'}`}
      >
        {refusal ?? ''}
      </p>
    </div>
  );
}
