import { useState, useRef, useEffect } from 'react';
import { Info } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface FieldHintProps {
  /** Plain-English explanation of the field */
  text: string;
  /** Valid value range, e.g. "1--10" */
  range?: string;
  /** Concrete example, e.g. "3 for moderate parallelism" */
  example?: string;
}

/**
 * Small info icon beside a label that shows a tooltip on hover/focus.
 * Displays: explanation, valid range, and a concrete example.
 */
export function FieldHint({ text, range, example }: FieldHintProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [above, setAbove] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Flip tooltip above if too close to viewport bottom
  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setAbove(rect.bottom + 120 > window.innerHeight);
  }, [open]);

  return (
    <span className="relative inline-flex items-center ml-1">
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="text-foreground hover:text-foreground transition-colors focus-ring rounded-sm"
        aria-label={t.shared.field_info}
      >
        <Info className="w-3.5 h-3.5" />
      </button>

      {open && (
        <div
          className={`absolute z-50 w-56 px-3 py-2 rounded-xl border border-primary/15 bg-background/95 backdrop-blur-md shadow-elevation-3 typo-body leading-relaxed ${
            above ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          } left-1/2 -translate-x-1/2`}
        >
          <p className="text-foreground">{text}</p>
          {range && (
            <p className="mt-1 text-foreground">
              <span className="font-semibold text-foreground/90">{t.shared.hint_range}</span> {range}
            </p>
          )}
          {example && (
            <p className="mt-0.5 text-foreground">
              <span className="font-semibold text-foreground/90">{t.shared.hint_example}</span>{' '}
              <code className="px-1 py-0.5 rounded bg-secondary/50 text-foreground font-mono">{example}</code>
            </p>
          )}
          {/* Arrow */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-2 h-2 rotate-45 border-primary/15 bg-background/95 ${
              above
                ? 'bottom-[-5px] border-r border-b'
                : 'top-[-5px] border-l border-t'
            }`}
          />
        </div>
      )}
    </span>
  );
}
