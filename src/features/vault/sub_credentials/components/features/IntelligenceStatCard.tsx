import type { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-secondary/20 border border-primary/10 rounded-modal">
      {icon}
      <div>
        <div className="text-xs font-semibold text-foreground/90 tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground/80">{label}</div>
      </div>
    </div>
  );
}
