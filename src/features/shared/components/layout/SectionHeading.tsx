import type { ReactNode } from 'react';

interface SectionHeadingProps {
  /** Simple string title — renders the icon/action variant. */
  title?: string;
  icon?: ReactNode;
  action?: ReactNode;
  /** Render arbitrary children as the heading text — uses the compact variant. */
  children?: ReactNode;
  /** Extra classes merged onto the outermost element. */
  className?: string;
  /** Semantic heading level. Defaults to h2 for title variant, h3 for children variant. */
  as?: 'h2' | 'h3' | 'h4';
}

export function SectionHeading({ title, icon, action, children, className = '', as }: SectionHeadingProps) {
  // --- Children variant (compact, used by cloud panels etc.) ---
  if (children !== undefined && children !== null) {
    const Tag = as ?? 'h3';
    return (
      <Tag className={`text-sm font-medium text-foreground uppercase tracking-wider ${className}`}>
        {children}
      </Tag>
    );
  }

  // --- Title variant (with optional icon & action, used by settings pages) ---
  const Tag = as ?? 'h2';

  const heading = (
    <div className={`flex items-center gap-2.5 ${className}`}>
      {icon && <span className="w-4 h-4 text-foreground shrink-0 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
      <Tag className="text-sm font-mono text-foreground uppercase tracking-wider">{title}</Tag>
    </div>
  );

  if (action) {
    return (
      <div className="flex items-center justify-between">
        {heading}
        {action}
      </div>
    );
  }

  return heading;
}
