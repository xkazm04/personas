import type { ReactNode } from 'react';

interface SectionHeaderProps {
  icon?: ReactNode;
  label: string;
  badge?: ReactNode;
  trailing?: ReactNode;
  className?: string;
  /** When true, hides badge and trailing actions for a cleaner look. */
  simplified?: boolean;
}

export function SectionHeader({ icon, label, badge, trailing, className, simplified }: SectionHeaderProps) {
  return (
    <div className={`flex items-center justify-between gap-3 ${className ?? ''}`}>
      <div className="flex items-center gap-2 px-1 min-w-0">
        {icon && <span className="text-foreground shrink-0">{icon}</span>}
        <p className="typo-label text-foreground/90 truncate">
          {label}
        </p>
        {!simplified && badge}
      </div>
      {!simplified && trailing && <div className="shrink-0">{trailing}</div>}
    </div>
  );
}
