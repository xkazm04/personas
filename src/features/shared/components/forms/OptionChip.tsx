import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export type OptionRole = 'tab' | 'radio' | 'option' | 'menuitem' | 'menuitemradio' | 'menuitemcheckbox';

/** The aria attribute that carries "selected" for a role (tab/option: aria-selected; radio/checkbox: aria-checked). */
export function optionSelectionProps(role: OptionRole | undefined, selected: boolean | undefined) {
  if (role === 'tab' || role === 'option') return { 'aria-selected': !!selected };
  if (role === 'radio' || role === 'menuitemradio' || role === 'menuitemcheckbox') return { 'aria-checked': !!selected };
  return { 'aria-pressed': selected };
}

export type OptionTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

// Tone only tints the selected ink/foot; unselected chips are always the neutral hairline look.
const TONE_SELECTED: Record<OptionTone, string> = {
  neutral: 'shadow-[inset_0_-2px_0_0_var(--primary)]',
  success: 'text-status-success shadow-[inset_0_-2px_0_0_var(--status-success)]',
  warning: 'text-status-warning shadow-[inset_0_-2px_0_0_var(--status-warning)]',
  error: 'text-status-error shadow-[inset_0_-2px_0_0_var(--status-error)]',
  info: 'text-status-info shadow-[inset_0_-2px_0_0_var(--status-info)]',
};

export interface OptionChipProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'role' | 'children'> {
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
  icon?: ReactNode;
  /** A count, rendered in mono tabular ink-3. */
  count?: number | string;
  disabled?: boolean;
  tone?: OptionTone;
  role?: OptionRole;
}

/**
 * @catalog Selectable chip (filter, segment, option): hairline, bg-sel + ink-1 + foot when selected, mono count; role tab/radio/option passthrough.
 */
export const OptionChip = forwardRef<HTMLButtonElement, OptionChipProps>(
  ({ selected, onSelect, children, icon, count, disabled, tone = 'neutral', role, className = '', type = 'button', ...rest }, ref) => {
    const classes = [
      'inline-flex items-center gap-1.5 h-[var(--control-h)] px-2.5 rounded-interactive border typo-label',
      'focus-ring transition-colors duration-100',
      selected ? `border-hair-2 bg-sel text-ink-1 ${TONE_SELECTED[tone]}` : 'border-hair text-ink-2 hover:bg-surface-2 hover:text-ink-1',
      disabled ? 'is-disabled' : 'cursor-pointer',
      className,
    ].join(' ');
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
        {icon ? <span className="flex-shrink-0">{icon}</span> : null}
        <span className="min-w-0">{children}</span>
        {count != null ? <span className="num typo-caption text-ink-3">{count}</span> : null}
      </button>
    );
  },
);
OptionChip.displayName = 'OptionChip';

export default OptionChip;
