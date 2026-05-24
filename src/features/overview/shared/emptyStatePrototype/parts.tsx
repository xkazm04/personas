import { motion } from 'framer-motion';
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
        <button
          onClick={action.onClick}
          className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-xl bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors focus-ring"
        >
          {action.icon && <action.icon className="w-3.5 h-3.5" />}
          {action.label}
        </button>
      )}
      {secondaryAction && (
        <button
          onClick={secondaryAction.onClick}
          className="inline-flex items-center gap-1.5 px-4 py-2 typo-heading rounded-xl text-foreground hover:text-foreground hover:bg-primary/8 border border-primary/10 transition-colors focus-ring"
        >
          {secondaryAction.icon && <secondaryAction.icon className="w-3.5 h-3.5" />}
          {secondaryAction.label}
        </button>
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
        className="typo-body-lg text-foreground/90 max-w-[42ch]"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.24, duration: 0.4 }}
      >
        {subtitle}
      </motion.p>
    </>
  );
}
