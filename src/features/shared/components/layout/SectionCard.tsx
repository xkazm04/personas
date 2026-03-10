import type { ReactNode } from 'react';

type SectionCardSize = 'sm' | 'md' | 'lg';

interface SectionCardProps {
  children: ReactNode;
  size?: SectionCardSize;
  blur?: boolean;
  className?: string;
}

const SIZE_CLASSES: Record<SectionCardSize, string> = {
  sm: 'rounded-lg p-2.5',
  md: 'rounded-xl p-3.5',
  lg: 'rounded-xl p-4',
};

export function SectionCard({ children, size = 'md', blur = false, className = '' }: SectionCardProps) {
  const blurClass = blur ? 'backdrop-blur-sm' : '';
  return (
    <div className={`bg-secondary/30 border border-primary/12 ${SIZE_CLASSES[size]} ${blurClass} ${className}`.trim()}>
      {children}
    </div>
  );
}
