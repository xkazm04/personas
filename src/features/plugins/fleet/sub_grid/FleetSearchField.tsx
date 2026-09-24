import { forwardRef } from 'react';
import { Search } from 'lucide-react';

interface FleetSearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Also the field's accessible name. */
  placeholder: string;
  'data-testid'?: string;
  className?: string;
}

/**
 * The Fleet pages' filter field: a search glyph inside a token-styled input.
 * The Sessions list and the Activity feed each hand-rolled one at a different
 * size (text-[14px], two paddings); both now render this. There is no shared
 * search input in `shared/components` yet, which is why it lives here.
 */
export const FleetSearchField = forwardRef<HTMLInputElement, FleetSearchFieldProps>(function FleetSearchField(
  { value, onChange, placeholder, 'data-testid': testId, className = '' },
  ref,
) {
  return (
    <div className={`relative ${className}`}>
      <Search
        className="pointer-events-none absolute left-2.5 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground"
        aria-hidden="true"
      />
      <input
        ref={ref}
        type="text"
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
        placeholder={placeholder}
        className="w-full h-8 rounded-input border border-primary/10 bg-secondary/40 pl-8 pr-3 typo-body text-foreground placeholder:text-foreground/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
      />
    </div>
  );
});
