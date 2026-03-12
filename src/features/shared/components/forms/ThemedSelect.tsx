import { forwardRef, useState, useRef, useCallback, useMemo, useEffect, type SelectHTMLAttributes } from 'react';
import { ChevronDown, Search, Check } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useDebounce } from '@/hooks/utility/timing/useDebounce';
import { highlightMatch } from '@/lib/ui/highlightMatch';

export interface ThemedSelectOption {
  value: string;
  label: string;
  description?: string;
  /** Optional icon URL (local SVG rendered via mask-image, or external image) */
  iconUrl?: string;
  /** Brand color for local SVG mask icons */
  iconColor?: string;
}

export interface ThemedSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Extra wrapper classes (width, margin, etc.) */
  wrapperClassName?: string;
  /** Enable text filter in dropdown. Off by default. */
  filterable?: boolean;
  /** Options for filterable mode */
  options?: ThemedSelectOption[];
  /** Controlled value (filterable mode) */
  value?: string;
  /** Change handler (filterable mode) */
  onValueChange?: (value: string) => void;
  /** Placeholder text (filterable mode) */
  placeholder?: string;
}

// -- Icon helper for options --------------------------------------

const isLocalSvg = (url: string) => url.startsWith('/') && url.endsWith('.svg');

function OptionIcon({ url, color, label }: { url: string; color?: string; label: string }) {
  if (isLocalSvg(url)) {
    return (
      <span
        role="img"
        aria-label={label}
        className="w-4 h-4 inline-block shrink-0"
        style={{
          maskImage: `url(${url})`,
          maskSize: 'contain',
          maskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskImage: `url(${url})`,
          WebkitMaskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          backgroundColor: color || 'currentColor',
        }}
      />
    );
  }
  return <img src={url} alt={label} className="w-4 h-4 shrink-0 rounded" referrerPolicy="no-referrer" crossOrigin="anonymous" />;
}

// -- Filterable dropdown ------------------------------------------

function FilterableSelect({
  options = [],
  value,
  onValueChange,
  placeholder = 'Select...',
  wrapperClassName = '',
  className = '',
}: Pick<ThemedSelectProps, 'options' | 'value' | 'onValueChange' | 'placeholder' | 'wrapperClassName' | 'className'>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => { setOpen(false); setQuery(''); }, []);
  useClickOutside(containerRef, open, close);

  // Focus search input when opening
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  const debouncedQuery = useDebounce(query, 150);

  const filtered = useMemo(() => {
    if (!debouncedQuery) return options;
    const q = debouncedQuery.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q));
  }, [options, debouncedQuery]);

  const selectedOption = options.find((o) => o.value === value);

  const handleSelect = (val: string) => {
    onValueChange?.(val);
    close();
  };

  const baseClasses = [
    'w-full appearance-none cursor-pointer',
    'px-3 py-2 pr-8 text-sm rounded-xl',
    'bg-background/50 text-foreground border border-primary/15',
    'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30',
    'transition-all text-left',
    className,
  ].join(' ');

  return (
    <div ref={containerRef} className={`relative ${wrapperClassName}`}>
      {/* Trigger */}
      <button type="button" onClick={() => setOpen((p) => !p)} className={baseClasses}>
        <span className={`flex items-center gap-2 ${selectedOption ? '' : 'text-muted-foreground/50'}`}>
          {selectedOption?.iconUrl && <OptionIcon url={selectedOption.iconUrl} color={selectedOption.iconColor} label={selectedOption.label} />}
          {selectedOption?.label ?? placeholder}
        </span>
      </button>
      <ChevronDown className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none transition-transform ${open ? 'rotate-180' : ''}`} />

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-1 left-0 right-0 z-50 rounded-xl border border-primary/15 bg-background shadow-lg overflow-hidden">
          {/* Search */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
            <Search className="w-3.5 h-3.5 text-muted-foreground/50 flex-shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter..."
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none"
            />
          </div>

          {/* Options */}
          <div className="max-h-48 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="px-3 py-2.5 text-sm text-muted-foreground/50">No matches</div>
            )}
            {filtered.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => handleSelect(opt.value)}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors hover:bg-primary/5 ${
                  opt.value === value ? 'bg-primary/5 text-foreground' : 'text-foreground/80'
                }`}
              >
                <span className="w-4 flex-shrink-0">
                  {opt.value === value && <Check className="w-3.5 h-3.5 text-primary" />}
                </span>
                {opt.iconUrl && <OptionIcon url={opt.iconUrl} color={opt.iconColor} label={opt.label} />}
                <span className="truncate">{highlightMatch(opt.label, debouncedQuery.trim())}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// -- Main export --------------------------------------------------

/**
 * Drop-in replacement for plain `<select>` that follows the app's
 * dark / light theme tokens for background, text, border, and options.
 *
 * Set `filterable` to render a custom dropdown with text search.
 */
export const ThemedSelect = forwardRef<HTMLSelectElement, ThemedSelectProps>(
  ({ className = '', wrapperClassName = '', filterable, options, value, onValueChange, placeholder, children, ...rest }, ref) => {
    if (filterable) {
      return (
        <FilterableSelect
          options={options}
          value={value as string}
          onValueChange={onValueChange}
          placeholder={placeholder}
          wrapperClassName={wrapperClassName}
          className={className}
        />
      );
    }

    return (
      <div className={`relative ${wrapperClassName}`}>
        <select
          ref={ref}
          className={[
            'w-full appearance-none cursor-pointer',
            'px-3 py-2 pr-8 text-sm rounded-xl',
            'bg-background/50 text-foreground border border-primary/15',
            'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30',
            'transition-all',
            '[&>option]:bg-background [&>option]:text-foreground',
            className,
          ].join(' ')}
          value={value}
          onChange={(e) => {
            onValueChange?.(e.target.value);
            rest.onChange?.(e);
          }}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
      </div>
    );
  },
);

ThemedSelect.displayName = 'ThemedSelect';
