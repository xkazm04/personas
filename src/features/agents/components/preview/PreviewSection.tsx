import type React from 'react';

/** Reusable preview section with icon, label, and optional count badge. */
export function PreviewSection({
  icon: Icon,
  label,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5">
        <Icon className="w-3 h-3 text-foreground" />
        <span className="typo-heading font-semibold text-foreground uppercase tracking-wider">{label}</span>
        {count != null && count > 0 && (
          <span className="ml-auto typo-data tabular-nums font-medium text-primary/60 bg-primary/8 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
