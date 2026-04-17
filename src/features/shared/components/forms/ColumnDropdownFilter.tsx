import { useState, useRef, useEffect } from 'react';
import { Filter, X } from 'lucide-react';

interface Option {
  value: string;
  label: string;
}

interface ColumnDropdownFilterProps {
  /** Label shown when no filter is active */
  label: string;
  /** Currently selected value */
  value: string;
  /** Filter options — first option should represent "no filter" (e.g. 'all') */
  options: Option[];
  /** Called when user picks an option */
  onChange: (value: string) => void;
  /** Value representing "no filter" (default: 'all') */
  allValue?: string;
}

/**
 * Column header dropdown filter used across Overview tables.
 * - Shows label + Filter icon on the right when not filtered.
 * - Shows selected label + X to clear when filtered (primary-colored).
 * - Dropdown appears below the trigger with high z-index to overlay tables.
 */
export function ColumnDropdownFilter({
  label,
  value,
  options,
  onChange,
  allValue = 'all',
}: ColumnDropdownFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const isFiltered = value !== allValue && value !== '';
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 typo-label transition-colors ${isFiltered ? 'text-primary' : 'text-foreground/80 hover:text-foreground'}`}
      >
        <span>{isFiltered ? selected?.label ?? label : label}</span>
        {isFiltered ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onChange(allValue); setOpen(false); }}
            className="p-0.5 rounded hover:bg-secondary/50 text-foreground hover:text-foreground"
          >
            <X className="w-3 h-3" />
          </button>
        ) : (
          <Filter className="w-3 h-3 text-foreground" />
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-[100] min-w-[160px] max-h-[320px] overflow-y-auto rounded-xl border border-primary/15 bg-background shadow-elevation-3">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                value === opt.value
                  ? 'bg-primary/10 text-foreground'
                  : 'text-muted-foreground/70 hover:bg-secondary/30'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
