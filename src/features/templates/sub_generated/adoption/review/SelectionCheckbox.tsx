import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { useTemplateMotion } from '@/features/templates/animationPresets';

export function SelectionCheckbox({ checked, onChange, id }: { checked: boolean; onChange: () => void; id?: string }) {
  const { motion: MOTION } = useTemplateMotion();

  return (
    <span
      role="presentation"
      className={`w-4 h-4 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${MOTION.snappy.css} cursor-pointer ${
        checked
          ? 'bg-violet-500 border border-violet-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onChange()}
        onClick={(e) => e.stopPropagation()}
        className="sr-only"
      />
      <AnimatePresence>
        {checked && (
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{ type: 'spring', damping: 15, stiffness: 400, ...MOTION.snappy.framer }}
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
