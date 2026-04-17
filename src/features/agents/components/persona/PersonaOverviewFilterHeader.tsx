import { useState, useRef, useEffect, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Filter } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface FilterOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface FilterHeaderProps {
  /** Header text shown on the button. */
  label: string;
  /** Currently selected filter value. */
  value: string;
  /** Sentinel value meaning "no filter applied" — defaults to "all". */
  unfilteredValue?: string;
  options: FilterOption[];
  onChange: (value: string) => void;
  /** Right-align the dropdown to the trigger (useful near the right edge). */
  alignRight?: boolean;
}

/**
 * Header cell that doubles as a filter dropdown trigger.
 *
 * Visual cues that distinguish it from a plain header:
 *   - leading Filter icon (always visible)
 *   - trailing ChevronDown icon
 *   - color shift + dot indicator when a non-default filter is active
 *
 * Renders the dropdown into a portal anchored to the trigger so it escapes the
 * sticky table header overflow.
 */
export function PersonaOverviewFilterHeader({
  label,
  value,
  unfilteredValue = 'all',
  options,
  onChange,
  alignRight = false,
}: FilterHeaderProps) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  const isFiltered = value !== unfilteredValue;
  const activeLabel = options.find((o) => o.value === value)?.label;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      ...(alignRight
        ? { right: window.innerWidth - rect.right }
        : { left: rect.left }),
      zIndex: 9999,
    });
  }, [open, alignRight]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={isFiltered && activeLabel ? `${label}: ${activeLabel}` : tx(t.agents.filters.filter_by, { label: label.toLowerCase() })}
        className={`group inline-flex items-center gap-1.5 px-1.5 py-1 -mx-1.5 rounded-input text-md font-semibold uppercase tracking-wider transition-colors ${
          isFiltered
            ? 'text-primary bg-primary/8 hover:bg-primary/12'
            : 'text-foreground/80 hover:text-foreground hover:bg-secondary/40'
        }`}
      >
        <Filter className={`w-3 h-3 ${isFiltered ? 'opacity-100' : 'opacity-50 group-hover:opacity-80'}`} />
        <span className="truncate">{label}</span>
        {isFiltered && <span className="w-1 h-1 rounded-full bg-primary" aria-hidden />}
        <ChevronDown className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open &&
        createPortal(
          <div
            ref={popRef}
            style={style}
            className="min-w-[180px] rounded-card border border-primary/15 bg-background shadow-elevation-3 shadow-black/20 py-1 max-h-64 overflow-y-auto animate-fade-slide-in"
          >
            {options.map((opt) => {
              const selected = value === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={`w-full px-3 py-1.5 text-md text-left transition-colors flex items-center gap-2 ${
                    selected
                      ? 'bg-primary/10 text-primary font-medium'
                      : 'text-foreground/80 hover:bg-secondary/50'
                  }`}
                >
                  {opt.icon && <span className="flex-shrink-0">{opt.icon}</span>}
                  <span className="truncate flex-1">{opt.label}</span>
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </>
  );
}
