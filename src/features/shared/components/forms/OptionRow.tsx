import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { optionSelectionProps, type OptionRole } from './OptionChip';

export interface OptionRowProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'role' | 'children'> {
  selected?: boolean;
  onSelect: () => void;
  children: ReactNode;
  /** Trailing meta (count, shortcut, state), rendered right-aligned in mono ink-3. */
  meta?: ReactNode;
  disabled?: boolean;
  /** Hairline under the row. */
  divided?: boolean;
  role?: OptionRole;
}

/**
 * @catalog Full-width menu/list option row: min row height, hover surface-1, selected bg-sel + 2px primary inset, optional mono meta; role passthrough.
 */
export const OptionRow = forwardRef<HTMLButtonElement, OptionRowProps>(
  ({ selected, onSelect, children, meta, disabled, divided, role, className = '', type = 'button', ...rest }, ref) => {
    const classes = [
      'flex w-full items-center gap-3 min-h-[var(--row-h)] px-3 text-left typo-body focus-ring transition-colors duration-100',
      selected ? 'bg-sel text-ink-1 shadow-[inset_2px_0_0_0_var(--primary)]' : 'text-ink-1 hover:bg-surface-1',
      divided ? 'border-b border-hair' : '',
      disabled ? 'is-disabled' : 'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <button
        {...rest}
        ref={ref}
        type={type}
        role={role}
        disabled={disabled}
        className={classes}
        onClick={onSelect}
        {...optionSelectionProps(role, selected)}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
        {meta != null ? <span className="num typo-caption text-ink-3 flex-shrink-0">{meta}</span> : null}
      </button>
    );
  },
);
OptionRow.displayName = 'OptionRow';

export default OptionRow;
