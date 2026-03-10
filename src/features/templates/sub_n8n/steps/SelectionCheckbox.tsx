import { Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WorkflowPlatform } from '@/lib/personas/parsers/workflowDetector';

export const PLATFORM_COLORS: Record<WorkflowPlatform, string> = {
  'n8n': 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  'zapier': 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  'make': 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  'github-actions': 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  'unknown': 'bg-zinc-500/15 text-zinc-400 border-zinc-500/20',
};

export function SelectionCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`w-4 h-4 rounded-lg flex items-center justify-center flex-shrink-0 transition-all duration-200 cursor-pointer ${
        checked
          ? 'bg-violet-500 border border-violet-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      <AnimatePresence>
        {checked && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 400, duration: 0.15 }}
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </button>
  );
}
