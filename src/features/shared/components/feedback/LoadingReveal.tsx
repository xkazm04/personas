import { AnimatePresence, motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import {
  useStableLoading,
  type StableLoadingOptions,
} from '@/hooks/utility/interaction/useStableLoading';

/**
 * @catalog LoadingReveal — flash-free loading gate: renders content, cross-fading a calm placeholder in only for slow loads (never for fast/cached ones), reduced-motion aware.
 *
 * The workhorse of the golden loading pattern (`docs/design/overview-loading.md`).
 * Render the static frame (ContentHeader + structure) around it, then wrap the
 * DATA region:
 *
 * ```tsx
 * <LoadingReveal loading={q.loading} placeholder={<ListSkeleton calm rows={8} />}>
 *   <UnifiedTable ... />
 * </LoadingReveal>
 * ```
 *
 * - **Fast / cached** (resolves within the grace window): `children` render
 *   immediately, faded in — no placeholder flash.
 * - **Slow**: the calm, content-shaped `placeholder` shows for a minimum
 *   duration, then cross-fades to `children`. Omit `placeholder` to show just
 *   the static frame while loading.
 * - **Reduced-motion**: instant swap, no cross-fade.
 *
 * Timing is governed by {@link useStableLoading} (anti-flash + anti-blink);
 * override via `timing`.
 */
export interface LoadingRevealProps {
  /** Raw loading flag from your data hook/store. */
  loading: boolean;
  /**
   * Calm, content-shaped placeholder (NOT a pulsing skeleton — use the `calm`
   * variant of `ListSkeleton`/`TableSkeleton`). Shown only for slow loads.
   * Omit to show nothing (just the static frame) while loading.
   */
  placeholder?: ReactNode;
  /** The real content — rendered once data is ready. */
  children: ReactNode;
  className?: string;
  /** Override the anti-flash grace / anti-blink min-visible windows. */
  timing?: StableLoadingOptions;
}

export function LoadingReveal({
  loading,
  placeholder,
  children,
  className,
  timing,
}: LoadingRevealProps) {
  const showLoading = useStableLoading(loading, timing);
  const { shouldAnimate } = useMotion();
  const duration = shouldAnimate ? 0.2 : 0;

  return (
    <div className={className}>
      <AnimatePresence mode="wait" initial={false}>
        {showLoading ? (
          <motion.div
            key="loading"
            initial={{ opacity: shouldAnimate ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration }}
          >
            {placeholder}
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={shouldAnimate ? { opacity: 0, y: 6 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
