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
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={tabId}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="relative"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
