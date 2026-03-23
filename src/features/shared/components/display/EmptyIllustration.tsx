import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyIllustrationProps {
  icon: LucideIcon;
  heading: string;
  description: string;
  cta?: ReactNode;
  className?: string;
}

export function EmptyIllustration({ icon: Icon, heading, description, cta, className = '' }: EmptyIllustrationProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${className}`}>
      {/* Double-ring decorative container */}
      <div className="rounded-2xl border border-dashed border-primary/10 p-3 mb-4">
        <div className="w-12 h-12 rounded-xl bg-secondary/40 flex items-center justify-center">
          <Icon className="w-6 h-6 text-muted-foreground/60" />
        </div>
      </div>
      <h4 className="text-sm font-medium mb-1">{heading}</h4>
      <p className="text-sm text-muted-foreground/60 max-w-xs mx-auto leading-relaxed">
        {description}
      </p>
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
