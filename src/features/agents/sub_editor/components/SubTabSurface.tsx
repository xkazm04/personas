import { motion, AnimatePresence } from 'framer-motion';
import type { ReactNode } from 'react';
import type { EditorTab } from '@/lib/types/types';

interface SubTabSurfaceProps {
  tabId: EditorTab;
  children: ReactNode;
}

export function SubTabSurface({ tabId, children }: SubTabSurfaceProps) {
  return (
    <div className="relative">
      <motion.div
        layoutId="sub-tab-accent-strip"
        aria-hidden
        className="pointer-events-none absolute left-0 top-1 bottom-1 w-[3px] rounded-r-full bg-primary"
        transition={{
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
