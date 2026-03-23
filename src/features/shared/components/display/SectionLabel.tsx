import type { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  className?: string;
  as?: 'h3' | 'h4' | 'h5' | 'div' | 'span' | 'p';
}

export function SectionLabel({ children, className = '', as: Tag = 'h4' }: SectionLabelProps) {
  return (
    <Tag className={`text-xs uppercase tracking-[0.12em] font-semibold text-muted-foreground/50 mb-2 ${className}`}>
      {children}
    </Tag>
  );
}
