import type { ReactNode } from 'react';

/** A headline figure: a tracked eyebrow over the number, which keeps the card-label glow (Gate 0). */
export function Stat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 px-2.5 py-2">
      <div className="flex items-center gap-1 typo-eyebrow mb-0.5">
        {icon}{label}
      </div>
      <div className="typo-card-label tabular-nums">{children}</div>
    </div>
  );
}

/** One column of the token breakdown. */
export function TokenCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="typo-eyebrow">{label}</div>
      <div className="typo-data">{children}</div>
    </div>
  );
}

/** A titled block of the Insights panel (tools used, files touched). */
export function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5 typo-label">
        {icon}{title}
      </div>
      {children}
    </div>
  );
}
