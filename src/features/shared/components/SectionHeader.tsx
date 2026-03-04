import type { ReactNode } from 'react';

interface SectionHeaderProps {
  icon?: ReactNode;
  label: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export function SectionHeader({ icon, label, badge, trailing, className }: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-1 min-w-0">
        {icon && <span className="text-muted-foreground/80 shrink-0">{icon}</span>}
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/80 truncate">
          {label}
        </p>
        {badge}
      </div>
      {trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
