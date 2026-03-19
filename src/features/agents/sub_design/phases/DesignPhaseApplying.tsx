import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
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
      <LoadingSpinner size="xl" className="text-primary" />
      <span className="text-sm text-muted-foreground/80">Applying changes...</span>
    </motion.div>
  );
}
