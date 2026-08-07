import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Mic, MicOff, Send } from 'lucide-react';
import Button, { type ButtonSize } from '@/features/shared/components/buttons/Button';

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
}

/**
 * @catalog Universal pill-shaped chat input row — text field + optional mic +
 * send button, parametric for size/placement and text-only vs text+voice.
 * Extracted from Studio's build-chat input; Studio wraps it unchanged (leading/
 * trailing slots carry its extra tool buttons), and the companion Orb's
 * quick-input bar uses the slim `size="sm"` + `voice` variant.
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
}: ChatInputBarProps) {
  const compact = size === 'sm';
  const sendButtonSize: ButtonSize = compact ? 'icon-sm' : 'sm';
  const areaRef = useRef<HTMLTextAreaElement>(null);

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
    if (e.key !== 'Enter') return;
    // Shift+Enter is a newline in multiline mode; everywhere else Enter sends.
    if (multiline && e.shiftKey) return;
    e.preventDefault();
    onSubmit();
  };

  const fieldClass = `min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-foreground/45 disabled:opacity-60 ${
    compact ? 'text-sm' : 'text-md'
  }`;

  return (
    <div
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
          className={`${fieldClass} resize-none overflow-y-auto scrollbar-thin py-1 leading-relaxed`}
        />
      ) : (
        <input
          data-testid={inputTestId}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
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
    </div>
  );
}
