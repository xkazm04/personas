import { motion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  iconColor?: string;
}

export default function EmptyState({ icon: Icon, title, description, action, iconColor = 'text-muted-foreground/80' }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center py-16 text-center"
    >
      <div className="w-14 h-14 rounded-2xl bg-secondary/60 border border-primary/15 flex items-center justify-center mb-4">
        <Icon className={`w-7 h-7 ${iconColor}`} />
      </div>
      <h3 className="text-sm font-medium text-foreground/90 mb-1">{title}</h3>
      {description && <p className="text-sm text-muted-foreground/90 max-w-xs">{description}</p>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
