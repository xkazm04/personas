import { forwardRef } from 'react';
import { GripVertical } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface DragHandleProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, 'aria-label'> {
  /** Visual size of the grip icon. Defaults to 'sm' (w-4 h-4). */
  size?: 'sm' | 'md';
  /**
   * Reveal the handle on hover of an ancestor with the `group` class (default),
   * or keep it always visible. Reorder lists that wrap each row in `group`
   * should leave this at `'hover'`; standalone handles use `'always'`.
   */
  reveal?: 'hover' | 'always';
  /** Override the localized aria-label (e.g. "Drag to reorder field"). */
  label?: string;
  className?: string;
}

const SIZE_CLS: Record<NonNullable<DragHandleProps['size']>, string> = {
  sm: 'w-4 h-4',
  md: 'w-5 h-5',
};

/**
 * Shared drag affordance: a grip icon that signals "this is draggable". Fades
 * in on `group-hover` by default and switches to a grabbing cursor while held.
 * Spread `draggable` + `onDragStart`/`onPointerDown` onto it for HTML5 drag, or
 * drop it inside a `Reorder.Item` purely as the visual handle.
 *
 * The handle is reduced-motion safe — the opacity fade is a CSS transition that
 * the global `prefers-reduced-motion` rule already neutralizes.
 */
export const DragHandle = forwardRef<HTMLSpanElement, DragHandleProps>(
  function DragHandle({ size = 'sm', reveal = 'hover', label, className = '', ...rest }, ref) {
    const { t } = useTranslation();
    const revealCls =
      reveal === 'hover'
        ? 'opacity-0 group-hover:opacity-60 hover:!opacity-100 focus-visible:opacity-100'
        : 'opacity-60 hover:opacity-100';
    return (
      <span
        ref={ref}
        aria-label={label ?? t.shared.drag_handle_aria}
        role="button"
        className={`inline-flex items-center justify-center text-foreground cursor-grab active:cursor-grabbing transition-opacity duration-150 ${revealCls} ${className}`}
        {...rest}
      >
        <GripVertical className={SIZE_CLS[size]} aria-hidden />
      </span>
    );
  },
);
