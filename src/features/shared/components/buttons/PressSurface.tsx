import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

export interface PressSurfaceProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'className' | 'children'> {
  /** Fired on click / Enter / Space. */
  onPress: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: ReactNode;
  /** Placement and layout only (w-full, flex, gap, padding, rounded). Never colour or type. */
  className?: string;
  /** Console selected wash (bg-sel); also sets aria-pressed unless the caller passes a role/aria of its own. */
  selected?: boolean;
  disabled?: boolean;
}

/**
 * @catalog A chrome-less semantic button wrapping arbitrary content (clickable card, tile, row): hover surface-1, selected bg-sel, focus ring.
 *
 * The one shared definition of "the whole surface is the press target". It carries no border,
 * fill, type or colour of its own; the children bring their own typography. Use `Button` for
 * anything that looks like a control, `OptionRow`/`OptionChip` for a choice.
 */
export const PressSurface = forwardRef<HTMLButtonElement, PressSurfaceProps>(
  ({ onPress, children, className = '', selected, disabled, type = 'button', ...rest }, ref) => {
    const classes = [
      'text-left focus-ring transition-colors duration-100',
      selected ? 'bg-sel' : 'hover:bg-surface-1',
      disabled ? 'is-disabled' : 'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ');
    return (
      <button
        aria-pressed={selected}
        {...rest}
        ref={ref}
        type={type}
        disabled={disabled}
        className={classes}
        onClick={onPress}
      >
        {children}
      </button>
    );
  },
);
PressSurface.displayName = 'PressSurface';

export default PressSurface;
