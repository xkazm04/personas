import { motion } from 'framer-motion';
import Button from '@/features/shared/components/buttons/Button';
import type { EmptyStateAction } from './types';

/** Primary + secondary CTA row, shared across both variants. Mirrors the
 * shared feedback/EmptyState button styling so the empty states stay coherent
 * with the rest of the app. */
export function EmptyStateActions({
  action,
  secondaryAction,
}: {
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateAction;
}) {
  if (!action && !secondaryAction) return null;
  return (
    <div className="flex items-center gap-3 mt-1">
      {action && (
        <Button variant="secondary" size="sm" onClick={action.onClick}>
          {action.icon && <action.icon className="w-3.5 h-3.5" />}
          {action.label}
        </Button>
      )}
      {secondaryAction && (
        <Button variant="secondary" size="sm" onClick={secondaryAction.onClick}>
          {secondaryAction.icon && <secondaryAction.icon className="w-3.5 h-3.5" />}
          {secondaryAction.label}
        </Button>
      )}
    </div>
  );
}

/** Title + subtitle block with a staggered fade-up entrance. */
export function EmptyStateCopy({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <>
      <motion.h3
        className="typo-heading-lg text-foreground"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15, duration: 0.4 }}
      >
        {title}
      </motion.h3>
      <motion.p
        className="typo-body-lg text-ink-2 max-w-[42ch]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.4 }}
      >
        {subtitle}
      </motion.p>
    </>
  );
}
