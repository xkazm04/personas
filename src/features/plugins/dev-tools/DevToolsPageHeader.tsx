// Unified Dev Tools module header — the Workspaces pattern applied everywhere:
// small primary-tinted icon + typo-heading title on one band with a bottom
// divider. `children` renders inline after the title (page tabs, filters);
// `actions` right-aligns (project picker, toolbars). Replaces the per-module
// mix of ContentHeader icon-badges and ad-hoc toolbar rows.
import type { LucideIcon } from 'lucide-react';

export function DevToolsPageHeader({ icon: Icon, iconNode, title, children, actions, testId }: {
  icon?: LucideIcon;
  /** Custom icon markup (e.g. an icon with a status overlay) — wins over `icon`. */
  iconNode?: React.ReactNode;
  title: string;
  /** Inline extras rendered right after the title (tabs, chips). */
  children?: React.ReactNode;
  /** Right-aligned cluster (project picker, buttons). */
  actions?: React.ReactNode;
  testId?: string;
}) {
  return (
    <div
      className="flex items-center gap-2 px-6 pt-5 pb-3 border-b border-primary/10 flex-shrink-0"
      data-testid={testId}
    >
      {iconNode ?? (Icon && <Icon className="w-5 h-5 text-primary flex-shrink-0" aria-hidden />)}
      <h1 className="typo-heading text-foreground truncate">{title}</h1>
      {children}
      {actions && <span className="ml-auto flex items-center gap-2 flex-shrink-0">{actions}</span>}
    </div>
  );
}
