import {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Loader2 } from 'lucide-react';
import Button, { type ButtonProps } from './Button';

export interface AsyncButtonProps extends Omit<ButtonProps, 'loading'> {
  /** True while the underlying async action is in flight. Disables the button and animates the spinner+label swap. */
  isLoading?: boolean;
  /** Optional label rendered while loading. Defaults to the resting label (children). */
  loadingText?: ReactNode;
}

const SWAP_TRANSITION = { duration: 0.18, ease: 'easeOut' } as const;

const AsyncButton = forwardRef<HTMLButtonElement, AsyncButtonProps>(function AsyncButton(
  { isLoading = false, loadingText, icon, disabled, children, onClick, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();

  // Real, synchronous self-disable (honors the catalog's "disables itself while an async
  // onClick is in flight" promise). The click event fires synchronously, before React can
  // commit a reactive `isLoading` re-render, so a fast double-click would otherwise invoke a
  // mutating handler twice. We set an in-flight ref synchronously at click time and ignore any
  // further click until the awaited onClick settles (cleared in a finally, so a *failed* action
  // can be retried). While in flight we also drive our own loading state so the spinner +
  // disabled state reflect it even when the caller never threads `isLoading`.
  const inFlightRef = useRef(false);
  const [internalLoading, setInternalLoading] = useState(false);
  const busy = isLoading || internalLoading;

  const handleClick = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      if (inFlightRef.current) {
        e.preventDefault();
        return;
      }
      if (!onClick) return;
      inFlightRef.current = true;
      let result: unknown;
      try {
        result = (onClick as (ev: MouseEvent<HTMLButtonElement>) => unknown)(e);
      } catch (err) {
        // Synchronous throw: release the guard so the action can be retried, then rethrow.
        inFlightRef.current = false;
        throw err;
      }
      if (result != null && typeof (result as { then?: unknown }).then === 'function') {
        setInternalLoading(true);
        void Promise.resolve(result).finally(() => {
          inFlightRef.current = false;
          setInternalLoading(false);
        });
      } else {
        // Synchronous onClick: nothing to await, so release immediately. (A caller that wraps
        // async work in a void handler still gets the reactive `isLoading` guard it threads.)
        inFlightRef.current = false;
      }
    },
    [onClick],
  );

  const restingLabel = children;
  const loadingLabel = loadingText ?? children;

  const restingContent = (
    <>
      {icon ? <span className="flex-shrink-0 inline-flex items-center">{icon}</span> : null}
      {restingLabel != null && restingLabel !== false ? (
        <span className="inline-flex items-center">{restingLabel}</span>
      ) : null}
    </>
  );

  const loadingContent = (
    <>
      <span className="flex-shrink-0 inline-flex items-center">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      </span>
      {loadingLabel != null && loadingLabel !== false ? (
        <span className="inline-flex items-center">{loadingLabel}</span>
      ) : null}
    </>
  );

  // With reduced-motion, fall through to Button's built-in icon/loading swap (no framer-motion animation).
  if (reduceMotion) {
    return (
      <Button
        ref={ref}
        icon={busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        onClick={handleClick}
        {...rest}
      >
        {busy ? (loadingText ?? children) : children}
      </Button>
    );
  }

  return (
    <Button
      ref={ref}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={handleClick}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={busy ? 'loading' : 'idle'}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={SWAP_TRANSITION}
          className="inline-flex items-center gap-1.5"
        >
          {busy ? loadingContent : restingContent}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
});

AsyncButton.displayName = 'AsyncButton';

export default AsyncButton;
