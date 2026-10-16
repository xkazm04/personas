import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';

/**
 * Press - the drafting sheet's one press target. The sheet's controls (sheet tabs, depth rail, level bar, queue
 * rows, option rows) are bands of a drawing, not buttons in a form: each is a whole-surface press on the plan's
 * paper, ruled by hairlines, so the shared Button (which has no class merge and no band geometry) cannot dress
 * them. This is the ONE local raw `<button>` of the blueprint; every other control composes it. Look and focus ring
 * live in blueprint.css under `.bp-press`.
 */
export interface PressProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'type'> {
  /** Extra layout classes (`bp-*`); the look itself is `.bp-press`. */
  tone?: string;
  /** The control is the chosen one of a group (tab, level). Sets aria-pressed. */
  on?: boolean;
  /** The row the camera and the keys are on. Sets aria-current. */
  current?: boolean;
  children?: ReactNode;
  /** React 19 passes a ref as a plain prop (the project switcher focuses its trigger back). */
  ref?: Ref<HTMLButtonElement>;
}

export function Press({ tone, on, current, children, ref, ...rest }: PressProps) {
  return (
    <button
      ref={ref}
      type="button"
      className={tone ? `bp-press ${tone}` : 'bp-press'}
      aria-pressed={rest.role === 'tab' ? undefined : on}
      aria-current={current ? 'true' : undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
