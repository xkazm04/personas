import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({ icon: Icon, title, hint, actionLabel, onAction }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-4">
      <Icon className="w-12 h-12 text-foreground/20" />
      <p className="typo-body text-foreground/50">{title}</p>
      {hint && <p className="typo-caption text-foreground/30 max-w-sm text-center">{hint}</p>}
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface NoActiveProjectProps {
  icon: LucideIcon;
  message: string;
  onGoToProjects?: () => void;
  goToProjectsLabel?: string;
}

export function NoActiveProject({ icon: Icon, message, onGoToProjects, goToProjectsLabel }: NoActiveProjectProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Icon className="w-10 h-10 text-foreground/20" />
      <p className="typo-body text-foreground/50">{message}</p>
      {onGoToProjects && goToProjectsLabel && (
        <button
          onClick={onGoToProjects}
          className="px-3 py-1.5 rounded-lg typo-caption bg-primary/20 text-primary hover:bg-primary/30 transition-colors"
        >
          {goToProjectsLabel}
        </button>
      )}
    </div>
  );
}
