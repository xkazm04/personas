import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';
import Button, { type ButtonSize } from '@/features/shared/components/buttons/Button';
import { ChatStarterChips, type ChatStarter } from './ChatStarterChips';
import { ChatInputSuggestions, type ChatInputSuggestion } from './ChatInputSuggestions';
import { useChatTypeahead } from './useChatTypeahead';

export type { ChatStarter, ChatInputSuggestion };

export interface ChatInputBarVoice {
  /** True when the browser exposes a speech-recognition implementation — hides the mic button otherwise. */
  supported: boolean;
  listening: boolean;
  onToggle: () => void;
  startLabel: string;
  listeningLabel: string;
}

export interface ChatInputBarProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** Disables the text input AND the send button (mirrors a turn already in flight). */
  disabled?: boolean;
  /** Shows the send button's loading spinner. */
  busy?: boolean;
  /** `md` (default) is Studio's full-size pill; `sm` is a slimmer variant for compact surfaces like the companion Orb. */
  size?: 'sm' | 'md';
  /** Passed straight through to the pill container's inline `boxShadow` (e.g. a state-driven glow). */
  boxShadow?: string;
  /** Rendered before the input — e.g. an expand/collapse toggle. */
  leading?: ReactNode;
  /** Rendered between the input (or mic) and the send button — e.g. extra tool buttons. */
  trailing?: ReactNode;
  /** Omit for a text-only bar; provide to add a mic toggle (text+voice). */
  voice?: ChatInputBarVoice;
  /** Accessible name for the send button. Omit to rely on `sendLabel`'s visible text instead. */
  sendAriaLabel?: string;
  /** Visible send-button label (e.g. "Send"). Hidden automatically in the `sm` size, which renders an icon-only button. */
  sendLabel?: ReactNode;
  sendTestId?: string;
  inputTestId?: string;
  autoFocus?: boolean;
  className?: string;
  /**
   * Grow into a textarea as the text wraps, instead of scrolling a single line
   * sideways. Off by default so existing callers are untouched.
   *
   * With it on, Enter still submits and Shift+Enter inserts a newline — the
   * same contract as the full chat composer, so muscle memory carries between
   * the two surfaces.
   */
  multiline?: boolean;
  /** Rows the field may grow to before it starts scrolling. Multiline only. */
  maxRows?: number;
  /**
   * Durable example prompts, rendered as a chip row ABOVE the pill while the
   * field is empty and enabled. Pressing a chip writes its `fill` into the
   * composer and focuses the field - it never submits, so the user can edit
   * before sending. The chips disappear on the first character and come back
   * if the field is cleared. Omit for the plain bar every caller had before.
   */
  starters?: ChatStarter[];
  /**
   * Typeahead slot. Pass the matches for whatever token the caller is tracking
   * (`@project`, `#skill`, an emoji prefix) and the bar renders an anchored
   * listbox, wears `role="combobox"` with a live `aria-activedescendant`, and
   * routes Arrow/Enter to the list instead of submitting. Omit it — or pass an
   * empty array — and the bar behaves exactly as it always did, with no
   * combobox attributes on the field.
   *
   * The caller still owns *what* is suggested: it parses the token, filters,
   * and applies the pick in `onSelectSuggestion`.
   */
  suggestions?: ChatInputSuggestion[];
  /** Called when the highlighted suggestion is chosen by Enter or click. */
  onSelectSuggestion?: (suggestion: ChatInputSuggestion) => void;
  /** Escape closes the list when provided (the caller clears its token). */
  onDismissSuggestions?: () => void;
  /** Accessible name for the suggestion listbox (already translated). */
  suggestionsLabel?: string;
}

/**
 * @catalog Universal pill-shaped chat input row — text field + optional mic +
 * send button, parametric for size/placement and text-only vs text+voice.
 * Extracted from Studio's build-chat input; Studio wraps it unchanged (leading/
 * trailing slots carry its extra tool buttons), and the companion Orb's
 * quick-input bar uses the slim `size="sm"` + `voice` variant. An optional
 * `suggestions` slot turns the field into a real combobox for @-mention style
 * typeahead without the caller touching the DOM.
 */
export function ChatInputBar({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  busy,
  size = 'md',
  boxShadow,
  leading,
  trailing,
  voice,
  sendAriaLabel,
  sendLabel,
  sendTestId,
  inputTestId,
  autoFocus,
  className = '',
  multiline = false,
  maxRows = 6,
  starters,
  suggestions,
  onSelectSuggestion,
  onDismissSuggestions,
  suggestionsLabel,
}: ChatInputBarProps) {
  const compact = size === 'sm';
  const sendButtonSize: ButtonSize = compact ? 'icon-sm' : 'sm';
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pillRef = useRef<HTMLDivElement>(null);
  const typeahead = useChatTypeahead(suggestions, onSelectSuggestion, onDismissSuggestions);

  // Auto-grow: reset to `auto` first so the height can SHRINK when text is
  // deleted (scrollHeight never reports smaller than the current height), then
  // adopt the content height up to the row cap. `useLayoutEffect` so the
  // resize is committed in the same frame as the keystroke — measuring in a
  // passive effect makes the field visibly lag a fast typist by one character.
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!multiline || !el) return;
    el.style.height = 'auto';
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, line * maxRows)}px`;
  }, [multiline, maxRows, value]);

  useEffect(() => {
    if (multiline && autoFocus) areaRef.current?.focus();
  }, [multiline, autoFocus]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // An open suggestion list gets first refusal on Arrow/Enter/Escape.
    if (typeahead.handleKeyDown(e)) return;
    if (e.key !== 'Enter') return;
    // Shift+Enter is a newline in multiline mode; everywhere else Enter sends.
    if (multiline && e.shiftKey) return;
    e.preventDefault();
    onSubmit();
  };

  const showStarters = !!starters?.length && value === '' && !disabled;

  const pickStarter = (starter: ChatStarter) => {
    onChange(starter.fill);
    // Focus after the value lands so the caret sits at the end of the fill and
    // the user can keep typing; the chip never submits on its own.
    requestAnimationFrame(() => {
      const el: HTMLInputElement | HTMLTextAreaElement | null = multiline ? areaRef.current : inputRef.current;
      if (!el) return;
      el.focus();
      const end = el.value.length;
      el.setSelectionRange(end, end);
    });
  };

  const fieldClass = `min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60 ${
    compact ? 'text-sm' : 'text-md'
  }`;

  const pill = (
    <div
      ref={pillRef}
      className={`pointer-events-auto flex border border-border bg-background/90 shadow-elevation-3 backdrop-blur transition-shadow duration-300 ${
        // A grown textarea inside a pill reads as a lozenge with the controls
        // stranded mid-height, so multiline switches to a softened rectangle and
        // bottom-aligns its buttons against the last line.
        multiline ? 'items-end rounded-3xl' : 'items-center rounded-full'
      } ${compact ? 'gap-1.5 py-1 pl-1.5 pr-1' : 'gap-2 py-1.5 pl-2 pr-1.5'} ${className}`}
      style={boxShadow ? { boxShadow } : undefined}
    >
      {leading}
      {multiline ? (
        <textarea
          ref={areaRef}
          rows={1}
          data-testid={inputTestId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          {...typeahead.comboboxProps}
          className={`${fieldClass} resize-none overflow-y-auto scrollbar-thin py-1 leading-relaxed`}
        />
      ) : (
        <input
          ref={inputRef}
          data-testid={inputTestId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          {...typeahead.comboboxProps}
          className={fieldClass}
        />
      )}
      {voice?.supported && (
        <button
          type="button"
          onClick={voice.onToggle}
          disabled={disabled}
          aria-pressed={voice.listening}
          aria-label={voice.listening ? voice.listeningLabel : voice.startLabel}
          title={voice.listening ? voice.listeningLabel : voice.startLabel}
          className={`flex shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-40 ${
            compact ? 'h-7 w-7' : 'h-8 w-8'
          } ${
            voice.listening
              ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25'
              : 'text-foreground/55 hover:bg-secondary/60 hover:text-primary'
          }`}
        >
          {voice.listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
      )}
      {trailing}
      <Button
        variant="primary"
        size={sendButtonSize}
        className="shrink-0 rounded-full"
        icon={<Send className="h-4 w-4" />}
        loading={busy}
        disabled={!value.trim() || disabled}
        onClick={onSubmit}
        data-testid={sendTestId}
        aria-label={sendAriaLabel}
      >
        {compact ? undefined : sendLabel}
      </Button>
      {/* Portalled, so its position in this tree costs the pill no layout. */}
      <ChatInputSuggestions
        anchorRef={pillRef}
        listboxId={typeahead.listboxId}
        suggestions={suggestions ?? []}
        activeIndex={typeahead.activeIndex}
        onPick={(item) => onSelectSuggestion?.(item)}
        onHoverIndex={typeahead.setActiveIndex}
        label={suggestionsLabel}
      />
    </div>
  );

  // Without starters the component renders EXACTLY what it rendered before -
  // no extra wrapper - so no existing caller's layout shifts.
  if (!showStarters) return pill;

  return (
    <div className="pointer-events-auto flex w-full flex-col gap-2">
      <ChatStarterChips starters={starters!} onPick={pickStarter} compact={compact} />
      {pill}
    </div>
  );
}
