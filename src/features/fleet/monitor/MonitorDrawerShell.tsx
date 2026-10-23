// MonitorDrawerShell — the top-down drawer the Monitor opens over its board.
//
// The persona drawer (`MonitorDrawer`) and the remote-session drawer
// (`remote/RemoteSessionDrawer`) are two contents in ONE shell: the dimmed,
// blurred backdrop that closes on click, and the sheet that springs down from
// the top edge while the board stays mounted underneath. Extracted from
// `PersonaMonitor` so the second drawer could not grow a second look.
//
// `fill` makes the sheet span the Monitor top to bottom (the mandate drawer):
// a sheet that ended part way down left the blurred board showing under its
// edge, which read as a drawer that had failed to open, not as a page.

import type { ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export function MonitorDrawerShell({ open, onClose, fill = false, children }: {
  open: boolean;
  onClose: () => void;
  /** Span the Monitor's full height instead of fitting the content. */
  fill?: boolean;
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
            data-fill={fill || undefined}
            className={`absolute inset-x-0 top-0 z-20 flex flex-col rounded-b-modal border-b border-x border-primary/15 bg-background shadow-elevation-4 ${fill ? 'bottom-0' : 'max-h-full'}`}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

export default MonitorDrawerShell;
