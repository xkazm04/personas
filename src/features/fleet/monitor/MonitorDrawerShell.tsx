// MonitorDrawerShell — the top-down drawer the Monitor opens over its board.
//
// The persona drawer (`MonitorDrawer`) and the remote-session drawer
// (`remote/RemoteSessionDrawer`) are two contents in ONE shell: the dimmed,
// blurred backdrop that closes on click, and the sheet that springs down from
// the top edge while the board stays mounted underneath. Extracted from
// `PersonaMonitor` so the second drawer could not grow a second look.

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function MonitorDrawerShell({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 z-10 bg-background/55 backdrop-blur-sm"
          />
          <motion.div
            key="drawer"
            initial={{ y: '-100%' }}
            animate={{ y: 0 }}
            exit={{ y: '-100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 34 }}
            className="absolute inset-x-0 top-0 z-20 max-h-full flex flex-col rounded-b-modal border-b border-x border-primary/15 bg-background shadow-elevation-4"
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default MonitorDrawerShell;
