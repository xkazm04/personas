import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ThemedSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Extra wrapper classes (width, margin, etc.) */
  wrapperClassName?: string;
}

/**
 * Drop-in replacement for plain `<select>` that follows the app's
 * dark / light theme tokens for background, text, border, and options.
 */
export const ThemedSelect = forwardRef<HTMLSelectElement, ThemedSelectProps>(
  ({ className = '', wrapperClassName = '', children, ...rest }, ref) => (
    <div className={`relative ${wrapperClassName}`}>
      <select
        ref={ref}
        className={[
          'w-full appearance-none cursor-pointer',
          'px-3 py-2 pr-8 text-sm rounded-lg',
          'bg-background/50 text-foreground border border-primary/15',
          'focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30',
          'transition-all',
          '[&>option]:bg-background [&>option]:text-foreground',
          className,
        ].join(' ')}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/60 pointer-events-none" />
    </div>
  ),
);

ThemedSelect.displayName = 'ThemedSelect';
