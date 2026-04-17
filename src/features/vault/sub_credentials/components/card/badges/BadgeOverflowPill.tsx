import { type ReactNode } from 'react';

export interface BadgeEntry {
  key: string;
  label: string;
  node: ReactNode;
}

export function BadgeOverflowPill({ badges }: { badges: BadgeEntry[] }) {
  return (
    <span
      className="typo-body font-medium px-1.5 py-0.5 rounded-full bg-secondary/50 border border-primary/10 text-foreground shrink-0 cursor-default"
      title={badges.map((b) => b.label).join(', ')}
    >
      +{badges.length}
    </span>
  );
}
