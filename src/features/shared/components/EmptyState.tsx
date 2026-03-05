import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
  iconColor?: string;
  iconContainerClassName?: string;
  className?: string;
  children?: ReactNode;
}

export default function EmptyState({
  icon: Icon,
  title,
  subtitle,
  description,
  action,
  iconColor = 'text-muted-foreground/80',
  iconContainerClassName = 'bg-secondary/35 border-primary/15',
  className,
  children,
}: EmptyStateProps) {
  const detailText = subtitle ?? description;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`py-8 flex flex-col items-center justify-center text-center gap-2.5 ${className ?? ''}`}
    >
      <div className={`w-10 h-10 rounded-2xl border flex items-center justify-center ${iconContainerClassName}`}>
        <Icon className={`w-4 h-4 ${iconColor}`} />
      </div>
      <h3 className="text-sm font-medium text-foreground/90">{title}</h3>
      {detailText && <p className="text-sm text-muted-foreground/60 max-w-[34ch]">{detailText}</p>}
      {children ? <div className="pt-1">{children}</div> : null}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 px-3 py-1.5 text-sm font-medium rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/15 transition-colors"
        >
          {action.label}
        </button>
      )}
    </motion.div>
  );
}
