import { motion, AnimatePresence } from 'framer-motion';
import { Brain } from 'lucide-react';

interface TeamMemoryBadgeProps {
  count: number;
  isOpen: boolean;
  isPulsing: boolean;
  onClick: () => void;
}

export default function TeamMemoryBadge({ count, isOpen, isPulsing, onClick }: TeamMemoryBadgeProps) {
  return (
    <AnimatePresence>
      {!isOpen && (
        <motion.button
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-secondary/90 backdrop-blur-lg border border-primary/15 shadow-lg hover:border-violet-500/30 transition-colors"
          onClick={onClick}
        >
          <div className="relative">
            <Brain className="w-4 h-4 text-violet-400" />
            {isPulsing && (
              <motion.div
                className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-violet-500"
                animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                transition={{ repeat: Infinity, duration: 1.5 }}
              />
            )}
          </div>
          <span className="text-sm font-medium text-foreground/80">{count}</span>
        </motion.button>
      )}
    </AnimatePresence>
  );
}
