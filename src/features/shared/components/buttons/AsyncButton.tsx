import { forwardRef, type ReactNode } from 'react';
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
  { isLoading = false, loadingText, icon, disabled, children, ...rest },
  ref,
) {
  const reduceMotion = useReducedMotion();

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
        icon={isLoading ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : icon}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        {...rest}
      >
        {isLoading ? (loadingText ?? children) : children}
      </Button>
    );
  }

  return (
    <Button
      ref={ref}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      {...rest}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={isLoading ? 'loading' : 'idle'}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -6 }}
          transition={SWAP_TRANSITION}
          className="inline-flex items-center gap-1.5"
        >
          {isLoading ? loadingContent : restingContent}
        </motion.span>
      </AnimatePresence>
    </Button>
  );
});

AsyncButton.displayName = 'AsyncButton';

export default AsyncButton;
