import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';

interface DropZoneGlowProps {
  active: boolean;
  label?: ReactNode;
  /**
   * Border radius (px) of the underlying drop zone — must match the parent's
   * `rounded-card` (8) / `rounded-modal` (12) so the SVG outline aligns.
   */
  radius?: number;
  /** Tailwind classes to override the default label chip styling. */
  labelClassName?: string;
}

/**
 * Layered drop affordance overlay rendered inside a `position: relative` parent.
 *
 * Layers when `active`:
 *   1. Outer ring scales 1.0 → 1.02 (180ms spring) with a soft primary glow.
 *   2. Inner SVG border: dashed primary/45 stroke, dasharray marches every 1.2s.
 *   3. Centered label chip fades in.
 *
 * On `active` → false all three reverse in 120ms.
 * `prefers-reduced-motion: reduce` disables the dasharray march via globals.css.
 */
export function DropZoneGlow({ active, label, radius = 12, labelClassName }: DropZoneGlowProps) {
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10"
          initial={{ opacity: 0, scale: 1.0 }}
          animate={{ opacity: 1, scale: 1.02 }}
          exit={{ opacity: 0, scale: 1.0, transition: { duration: 0.12 } }}
          transition={{
            opacity: { duration: 0.18 },
            scale: { type: 'spring', stiffness: 380, damping: 28, mass: 0.6 },
          }}
          style={{ borderRadius: radius, transformOrigin: 'center' }}
        >
          <div
            className="absolute inset-0"
            style={{
              borderRadius: radius,
              boxShadow:
                '0 0 0 1px color-mix(in srgb, var(--color-primary) 30%, transparent), 0 0 24px color-mix(in srgb, var(--color-primary) 22%, transparent)',
            }}
          />

          <svg
            className="absolute inset-0 h-full w-full overflow-visible"
            preserveAspectRatio="none"
          >
            <rect
              fill="none"
              stroke="color-mix(in srgb, var(--color-primary) 45%, transparent)"
              strokeWidth={1.5}
              strokeDasharray="8 5"
              className="dropzone-dash-march"
              style={{
                x: '1.5px',
                y: '1.5px',
                width: 'calc(100% - 3px)',
                height: 'calc(100% - 3px)',
                rx: `${Math.max(0, radius - 1)}px`,
                ry: `${Math.max(0, radius - 1)}px`,
              }}
            />
          </svg>

          {label && (
            <motion.div
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 2, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, delay: 0.05 }}
            >
              <span
                className={
                  labelClassName ??
                  'px-3 py-1.5 rounded-card bg-primary/15 text-primary border border-primary/30 typo-body font-medium shadow-elevation-1'
                }
              >
                {label}
              </span>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
