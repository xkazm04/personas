// The NOTEPAD: the workspace layer as index tabs along the top of the panel.
//
// A tab is a physical place in a ring binder — it sits ON the sheet below it,
// the open one merges with the sheet, and the closed ones are behind it. That
// is the whole reason this is a notepad and not another segmented control: a
// segment strip says "pick a mode", a tab says "you are looking at this one of
// several sheets", which is exactly what a workspace is.
//
// "All workspaces" is the first tab and the resting state, so the panel is
// never silently showing a slice. A workspace that owes a human something
// carries that count on its tab — the thing you would switch FOR is visible
// from the tab you are on.
//
// THE STRIP AND ITS SHEET ARE DECLARED IN ONE FILE, as `CommandBar` does with
// `CommandFloor`: a tablist is a promise that some region is the thing it
// selects, and the only way that promise cannot dangle is for the id the tab
// points at and the region carrying it to be written side by side.

import type { ReactNode } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import type { WorkspaceScope } from './workspaceScope';

const PREFIX = 'entry-e-workspace';
const ALL = 'all';

const tabId = (id: string | null) => `${PREFIX}-tab-${id ?? ALL}`;
const panelId = (id: string | null) => `${PREFIX}-panel-${id ?? ALL}`;

export function WorkspaceTabs({ scope }: { scope: WorkspaceScope }) {
  const { t } = useTranslation();
  // One workspace is not a choice: the strip would cost a row to say the panel
  // shows what it already shows.
  if (scope.tabs.length < 2) return null;

  const tab = (id: string | null, label: ReactNode, testId: string) => {
    const on = scope.activeId === id;
    return (
      <Button
        key={id ?? ALL}
        variant="ghost"
        size="xs"
        role="tab"
        id={tabId(id)}
        aria-controls={panelId(id)}
        aria-selected={on}
        onClick={() => scope.pick(on ? null : id)}
        data-testid={testId}
        className={`ae-note ae-focus typo-caption text-foreground ${on ? 'is-active' : ''}`}
      >
        {label}
      </Button>
    );
  };

  return (
    <div className="ae-notes flex-shrink-0" role="tablist" aria-label={t.monitor.layers_workspace_aria} data-testid="entry-e-workspaces">
      {tab(null, t.monitor.layers_all_workspaces, 'entry-e-workspace-all')}
      {scope.tabs.map((w) => tab(
        w.id,
        <>
          <span className="ae-note-swatch" style={{ background: w.color }} aria-hidden />
          <span className="max-w-[11rem] truncate">{w.name}</span>
          {w.needsYou > 0 && <span className="ae-note-count tabular-nums"><Numeric value={w.needsYou} /></span>}
        </>,
        `entry-e-workspace-${w.id}`,
      ))}
    </div>
  );
}

/**
 * The sheet the notepad turns to: the board region, labelled by the tab that
 * selected it.
 */
export function WorkspaceSheet({
  scope, className, children,
}: { scope: WorkspaceScope; className?: string; children: ReactNode }) {
  // No strip, no tab to be labelled by: a panel pointing at an id that was
  // never rendered is exactly the dangling claim the pair exists to avoid.
  if (scope.tabs.length < 2) return <div className={className}>{children}</div>;
  return (
    <div
      role="tabpanel"
      id={panelId(scope.activeId)}
      aria-labelledby={tabId(scope.activeId)}
      className={className}
    >
      {children}
    </div>
  );
}
