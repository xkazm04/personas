import type { ReactNode } from 'react';

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
}

export function StatCard({ icon, label, value }: StatCardProps) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 bg-surface-1 border border-hair rounded-modal">
      {icon}
      <div>
        <div className="typo-caption text-ink-1 tabular-nums">{value}</div>
        <div className="typo-caption text-foreground">{label}</div>
      </div>
    </div>
  );
}
