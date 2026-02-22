import { Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';

export function DesignPhaseApplying() {
  return (
    <motion.div
      key="applying"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col items-center justify-center py-12 gap-3"
    >
      <Loader2 className="w-6 h-6 text-primary animate-spin" />
      <span className="text-sm text-muted-foreground/60">Applying changes...</span>
    </motion.div>
  );
}
