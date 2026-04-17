interface LabEmptyStateProps {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  size?: 'compact' | 'standard' | 'full';
}

export function LabEmptyState({ icon: Icon, title, subtitle, action, size = 'standard' }: LabEmptyStateProps) {
  if (size === 'compact') {
    return (
      <div className="flex items-center gap-2 py-4 px-3">
        <Icon className="w-5 h-5 text-foreground/40 flex-shrink-0" />
        <span className="text-sm text-foreground/60">{title}</span>
      </div>
    );
  }

  return (
    <div className={`text-center bg-secondary/30 border border-primary/10 rounded-modal ${size === 'full' ? 'py-12' : 'py-8'}`}>
      <Icon className="w-8 h-8 text-foreground/40 mx-auto mb-3" />
      <p className="text-sm text-foreground/70">{title}</p>
      {subtitle && <p className="text-xs text-foreground/50 mt-1">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
