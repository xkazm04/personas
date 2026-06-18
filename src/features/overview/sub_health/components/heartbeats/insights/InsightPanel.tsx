import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Shared premium panel shell for the insight band — a grade-accented header
// tile + title/subtitle + flexible body. Equal-height in a stretch grid.
// ---------------------------------------------------------------------------

export type Accent = 'success' | 'warning' | 'error' | 'info' | 'primary';

const ACCENT: Record<Accent, { tile: string; line: string }> = {
  success: { tile: 'bg-status-success/10 border-status-success/20 text-status-success', line: 'bg-status-success' },
  warning: { tile: 'bg-status-warning/10 border-status-warning/20 text-status-warning', line: 'bg-status-warning' },
  error: { tile: 'bg-status-error/10 border-status-error/20 text-status-error', line: 'bg-status-error' },
  info: { tile: 'bg-status-info/10 border-status-info/20 text-status-info', line: 'bg-status-info' },
  primary: { tile: 'bg-primary/10 border-primary/20 text-primary', line: 'bg-primary' },
};

export function InsightPanel({ icon: Icon, accent, title, subtitle, children }: {
  icon: LucideIcon;
  accent: Accent;
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  const ac = ACCENT[accent];
  return (
    <section className="flex flex-col rounded-modal border border-primary/10 bg-secondary/5 shadow-elevation-1 overflow-hidden">
      <div className={`h-0.5 ${ac.line} opacity-50`} />
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className={`w-8 h-8 rounded-card border flex items-center justify-center shrink-0 ${ac.tile}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="typo-heading text-foreground/90 truncate">{title}</h3>
          {subtitle && <p className="typo-caption text-foreground truncate">{subtitle}</p>}
        </div>
      </div>
      <div className="px-3 pb-3 flex-1">{children}</div>
    </section>
  );
}
