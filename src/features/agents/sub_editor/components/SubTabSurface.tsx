import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import type { EditorTab } from '@/lib/types/types';

/**
 * Per-tab accent identity for the persona editor workspaces.
 * RGB triplets keep the values usable in both Tailwind utility expressions
 * and inline gradient strings without requiring tailwind config edits
 * (this project uses Tailwind v4 via @tailwindcss/vite — no JS config file).
 *
 * Add a new sub-tab? Drop an entry here and the surface inherits accent +
 * wash automatically.
 */
const TAB_ACCENT: Record<EditorTab, string> = {
  design:      '139 92 246',  // violet-500
  chat:        '59 130 246',  // blue-500
  lab:         '16 185 129',  // emerald-500
  activity:    '245 158 11',  // amber-500
  'use-cases': '244 63 94',   // rose-500
  settings:    '100 116 139', // slate-500 (neutral, no shouting)
  matrix:      '100 116 139', // legacy fallback
  assertions:  '14 165 233',  // sky-500
};

const FALLBACK_RGB = '100 116 139';

interface SubTabSurfaceProps {
  tabId: EditorTab;
  children: ReactNode;
}

export function SubTabSurface({ tabId, children }: SubTabSurfaceProps) {
  const rgb = TAB_ACCENT[tabId] ?? FALLBACK_RGB;
  return (
    <div className="relative">
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 rounded-modal"
        animate={{ background: `linear-gradient(135deg, rgb(${rgb} / 0.025), transparent 60%)` }}
        transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
      />
      <motion.div
        layoutId="sub-tab-accent-strip"
        aria-hidden
        className="pointer-events-none absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full"
        animate={{ backgroundColor: `rgb(${rgb})` }}
        transition={{
          backgroundColor: { duration: 0.24, ease: [0.4, 0, 0.2, 1] },
          layout: { type: 'spring', stiffness: 400, damping: 32 },
        }}
      />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tabId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="relative pl-3"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
