import {
  forwardRef,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode,
} from 'react';
import { Tooltip } from '../display/Tooltip';

// -- Variant + Size types --------------------------------------

export type ButtonVariant =
  | 'primary'    // Filled accent -- main CTA
  | 'secondary'  // Bordered, subtle fill on hover
  | 'ghost'      // No border/bg, text-only + hover fill
  | 'danger'     // Red destructive action
  | 'accent'     // Tinted by `tone`: a status or a role, never a hue
  | 'link';      // Inline text link style, no padding

export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon-sm' | 'icon-md' | 'icon-lg';

// -- Style maps ------------------------------------------------

// NOTE: the active:scale-[0.98] press response lives in the base class list (see `classes`
// below) so every variant gets identical tactile feedback in one place. Variant entries only
// declare their color/border/shadow surface.
const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'brightness-lock bg-btn-primary text-btn-primary-fg hover:bg-btn-primary/90 shadow-elevation-1 hover:shadow-elevation-2',
  secondary:
    'border border-border bg-secondary/40 text-foreground/90 hover:bg-secondary/70 hover:border-border/80',
  ghost:
    'text-foreground hover:text-foreground hover:bg-secondary/50 active:bg-secondary/70',
  danger:
    'brightness-lock bg-red-600/90 text-btn-danger-fg hover:bg-red-600 border border-red-500/30 shadow-elevation-1',
  // Colour comes from `tone` (TONE_CLASSES) or, without one, the neutral ink below;
  // the variant itself holds no text colour, so a tone never fights a second one.
  accent:
    'border',
  link:
    'text-primary hover:text-primary/80 underline-offset-2 hover:underline p-0 h-auto rounded-none',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  xs:       'px-2 py-0.5 text-md rounded-md gap-1',
  sm:       'px-2.5 py-1 text-md rounded-lg gap-1.5',
  md:       'px-3.5 py-1.5 text-md rounded-xl gap-2',
  lg:       'px-5 py-2.5 text-md rounded-xl gap-2.5',
  // Coarse-pointer (touch) bump to 44x44 — WCAG 2.5.5 / HIG 44pt / Material 48dp.
  // icon-lg is already 44px; the global `pointer: coarse` rule in globals.css
  // supplies min-height, these add the matching width so icon buttons stay square.
  'icon-sm': 'w-7 h-7 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 rounded-lg p-0 justify-center',
  'icon-md': 'w-9 h-9 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 rounded-xl p-0 justify-center',
  'icon-lg': 'w-11 h-11 rounded-xl p-0 justify-center',
};

// -- Props -----------------------------------------------------

/**
 * What an accent button's action MEANS. A closed set named for meaning, never for
 * a hue (docs/design/style-mastery/doctrine.md section 4): the four statuses say how
 * something goes (approve is success, reject is error), the four roles say who or
 * what acts (agent, human, external) or plain emphasis (highlight). Adding a tone
 * is a design decision, not a call-site convenience.
 */
export type ButtonTone =
  | 'agent' | 'human' | 'external' | 'highlight'
  | 'success' | 'warning' | 'error' | 'info';

// The ONE tone -> token mapping (the chip recipe: 10% fill, 30% rule, full ink).
// Every class is written out so Tailwind sees it; every token is bound per theme,
// so no light-theme repair selector is needed.
const TONE_CLASSES: Record<ButtonTone, string> = {
  agent:     'border-role-agent/30 bg-role-agent/10 text-role-agent hover:bg-role-agent/20',
  human:     'border-role-human/30 bg-role-human/10 text-role-human hover:bg-role-human/20',
  external:  'border-role-external/30 bg-role-external/10 text-role-external hover:bg-role-external/20',
  highlight: 'border-role-highlight/30 bg-role-highlight/10 text-role-highlight hover:bg-role-highlight/20',
  success:   'border-status-success/30 bg-status-success/10 text-status-success hover:bg-status-success/20',
  warning:   'border-status-warning/30 bg-status-warning/10 text-status-warning hover:bg-status-warning/20',
  error:     'border-status-error/30 bg-status-error/10 text-status-error hover:bg-status-error/20',
  info:      'border-status-info/30 bg-status-info/10 text-status-info hover:bg-status-info/20',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** For the 'accent' variant: what the action means. Without it the button is a neutral bordered one. */
  tone?: ButtonTone;
  /** Optional left icon */
  icon?: ReactNode;
  /** Optional right icon */
  iconRight?: ReactNode;
  /** Full width */
  block?: boolean;
  /** Show loading spinner */
  loading?: boolean;
  /**
   * Optional in-flight label rendered in place of children while `loading` is true.
   * Pass an i18n-resolved string like `t.common.saving` to give users an honest
   * progress signal. When omitted, children stay rendered (dimmed) during loading.
   */
  loadingLabel?: ReactNode;
  /** Tooltip shown when the button is disabled, explaining why */
  disabledReason?: string;
}

// -- Component -------------------------------------------------

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'secondary',
      size = 'md',
      tone,
      icon,
      iconRight,
      block,
      loading,
      loadingLabel,
      disabled,
      disabledReason,
      className = '',
      children,
      type = 'button',
      style,
      onClick,
      // Pulled out of `rest` DELIBERATELY. The attribute below is written after
      // the spread, so an incoming `aria-busy` used to be clobbered with
      // `undefined` — which is what happened to every `AsyncButton` in the app:
      // it computes its own busy state, passes `aria-busy`, and Button erased
      // it, so a control that visibly span reported nothing to a screen reader
      // (found 2026-09-05 while testing the notepad dispatch bar).
      'aria-busy': ariaBusy,
      ...rest
    },
    ref,
  ) => {
    const isDisabled = disabled || loading;
    const showReason = isDisabled && !!disabledReason;
    const isIconOnly = size === 'icon-sm' || size === 'icon-md' || size === 'icon-lg';

    // Width-preserving loading: capture the resting rect when loading starts so the
    // button doesn't collapse while content swaps to a loading label or stays dimmed.
    // Skipped for icon-only sizes (already fixed-dimension via w-*).
    const innerRef = useRef<HTMLButtonElement | null>(null);
    const [lockedMinWidth, setLockedMinWidth] = useState<number | null>(null);
    const wasLoadingRef = useRef(!!loading);

    useLayoutEffect(() => {
      const wasLoading = wasLoadingRef.current;
      wasLoadingRef.current = !!loading;
      if (isIconOnly) return;
      if (loading && !wasLoading && innerRef.current) {
        setLockedMinWidth(innerRef.current.getBoundingClientRect().width);
      } else if (!loading && wasLoading) {
        setLockedMinWidth(null);
      }
    }, [loading, isIconOnly]);

    const setRefs = useCallback(
      (node: HTMLButtonElement | null) => {
        innerRef.current = node;
        if (typeof ref === 'function') ref(node);
        else if (ref) (ref as MutableRefObject<HTMLButtonElement | null>).current = node;
      },
      [ref],
    );

    // Double-submit guard — only engages when `onClick` returns a thenable (i.e. an async
    // handler). The native click event is dispatched synchronously, so a fast double-click
    // can fire twice before React commits a reactive `loading`/`disabled` re-render. We block
    // the second invocation while the first promise is still pending via a synchronous ref.
    // Plain synchronous (void-returning) handlers NEVER set the ref, so rapid-click controls
    // (steppers, toggles, paginators) keep firing on every click exactly as before.
    const inFlightRef = useRef(false);
    const handleClick = useCallback(
      (e: MouseEvent<HTMLButtonElement>) => {
        if (!onClick) return;
        if (inFlightRef.current) {
          e.preventDefault();
          return;
        }
        const result = (onClick as (ev: MouseEvent<HTMLButtonElement>) => unknown)(e);
        if (result != null && typeof (result as { then?: unknown }).then === 'function') {
          inFlightRef.current = true;
          void Promise.resolve(result).finally(() => {
            inFlightRef.current = false;
          });
        }
      },
      [onClick],
    );

    const accentClasses = variant !== 'accent'
      ? ''
      : tone
        ? `${TONE_CLASSES[tone]} font-semibold`
        : 'text-foreground/90';

    const classes = [
      // transition-all carries hover color/shadow; duration-100 + active:scale gives every button
      // a snappy tactile press response (disabled buttons are pointer-events-none, so :active never
      // fires on them). Defined once here rather than per-variant.
      'inline-flex items-center font-medium transition-all duration-100 active:scale-[0.98]',
      'focus-ring',
      VARIANT_CLASSES[variant],
      accentClasses,
      SIZE_CLASSES[size],
      block ? 'w-full justify-center' : '',
      // `is-disabled` is a project utility (see globals.css) pairing --disabled-opacity with
      // cursor-not-allowed + pointer-events-none. We keep pointer-events-none even with a reason:
      // a native disabled <button> swallows pointer/focus events regardless, so the Tooltip's
      // focusable wrapper (tabIndex 0 span) is what surfaces the reason — hover falls through the
      // inert button to that wrapper, and Tab lands on the wrapper rather than the dead button.
      isDisabled ? 'is-disabled' : 'cursor-pointer',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    const lockedStyle =
      lockedMinWidth != null && !isIconOnly ? { minWidth: `${lockedMinWidth}px` } : undefined;
    const mergedStyle =
      lockedStyle || style ? { ...lockedStyle, ...style } : undefined;
    const labelContent = loading && loadingLabel !== undefined ? loadingLabel : children;
    const dimClass = loading ? 'opacity-60' : '';

    const btn = (
      <button
        {...rest}
        ref={setRefs}
        type={type}
        disabled={isDisabled}
        className={classes}
        style={mergedStyle}
        aria-busy={loading || ariaBusy || undefined}
        onClick={onClick ? handleClick : undefined}
      >
        {loading && isIconOnly ? (
          <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
          </svg>
        ) : (
          <>
            {loading && (
              <svg className="w-3 h-3 animate-spin flex-shrink-0" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-25" />
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
              </svg>
            )}
            {icon && !loading ? (
              <span className="flex-shrink-0">{icon}</span>
            ) : null}
            {labelContent != null && labelContent !== false ? (
              <span className={dimClass || undefined}>{labelContent}</span>
            ) : null}
            {iconRight ? (
              <span className={`flex-shrink-0 ${dimClass}`.trim()}>{iconRight}</span>
            ) : null}
          </>
        )}
      </button>
    );

    if (showReason) {
      // triggerFocusable makes the wrapper span the focus/hover target so the reason surfaces for
      // mouse AND keyboard users even though the disabled button itself is inert. The wrapper must
      // match the button's layout footprint (full width for block buttons) and show the
      // not-allowed cursor, since the pointer-events-none button can't render its own. focus-ring
      // gives keyboard users a visible focus indicator on the wrapper (the inert button's own
      // focus-ring never shows because it can't be focused); rounded-xl keeps the ring on-radius.
      const wrapperClass = `${block ? 'flex w-full' : 'inline-flex'} cursor-not-allowed focus-ring rounded-xl`;
      return (
        <Tooltip
          content={disabledReason}
          placement="top"
          delay={200}
          triggerFocusable
          triggerClassName={wrapperClass}
        >
          {btn}
        </Tooltip>
      );
    }

    return btn;
  },
);

Button.displayName = 'Button';

export default Button;
