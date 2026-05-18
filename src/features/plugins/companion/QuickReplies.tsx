/**
 * QuickReplies — the chip strip Athena offers at the end of a turn when
 * she emits a `QR: [...]` line. Each option is a preset user message;
 * clicking sends it through the same send pipeline as typed text.
 *
 * Keyboard shortcut: when chips are visible and the user isn't typing
 * in the composer, pressing 1–9 fires the matching option. Useful for
 * keyboard-only flow.
 */
import { useEffect } from 'react';

export function QuickReplies({
  options,
  disabled,
  onPick,
}: {
  options: string[];
  disabled: boolean;
  onPick: (text: string) => void;
}) {
  useEffect(() => {
    if (options.length === 0 || disabled) return;
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === 'textarea' || tag === 'input') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const n = parseInt(e.key, 10);
      if (Number.isNaN(n) || n < 1 || n > options.length) return;
      const picked = options[n - 1];
      if (!picked) return;
      e.preventDefault();
      onPick(picked);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [options, disabled, onPick]);

  if (options.length === 0) return null;

  return (
    <div className="border-t border-foreground/10 px-3 py-2 flex flex-wrap gap-1.5 shrink-0">
      {options.map((opt, i) => (
        <button
          key={`${i}-${opt}`}
          onClick={() => onPick(opt)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 max-w-full rounded-interactive bg-primary/10 hover:bg-primary/20 text-primary px-2.5 py-1.5 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus-ring"
          title={opt}
        >
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-semibold bg-primary/20"
            aria-hidden
          >
            {i + 1}
          </span>
          <span className="truncate">{opt}</span>
        </button>
      ))}
    </div>
  );
}
