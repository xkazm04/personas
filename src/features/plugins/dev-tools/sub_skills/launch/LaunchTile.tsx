// One project tile on the Launchpad grid: name, tech chips, version facts for
// the selected skill, a status light + StatusBadge, and the per-status
// affordance (whole-tile launch / adopt button / disabled with hint).
import { Rocket } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { StatusBadge, type StatusVariant } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { LaunchStatus, ProjectLaunchCell } from './launchTypes';

const DOT: Record<LaunchStatus, string> = {
  ready: 'bg-status-success',
  needs_adopt: 'bg-status-neutral',
  adopting: 'bg-status-warning',
  running: 'bg-status-info',
};

const BADGE: Record<LaunchStatus, StatusVariant> = {
  ready: 'success',
  needs_adopt: 'neutral',
  adopting: 'warning',
  running: 'info',
};

export function techChips(techStack: string | null): string[] {
  return (techStack ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 4);
}

export function LaunchTile({ cell, onLaunch, onAdopt }: {
  cell: ProjectLaunchCell;
  onLaunch: (cell: ProjectLaunchCell) => void;
  onAdopt: (cell: ProjectLaunchCell) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const statusLabel: Record<LaunchStatus, string> = {
    ready: d.launch_status_ready,
    needs_adopt: d.launch_status_needs_adopt,
    adopting: d.launch_status_adopting,
    running: d.launch_status_running,
  };
  const chips = techChips(cell.project.tech_stack);

  const body = (dimmed: boolean) => (
    <>
      <div className={dimmed ? 'opacity-60' : undefined}>
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${DOT[cell.status]}`} aria-hidden />
          <span className="typo-body font-medium text-foreground/90 truncate">{cell.project.name}</span>
          <StatusBadge variant={BADGE[cell.status]} size="sm" className="ml-auto flex-shrink-0">
            {statusLabel[cell.status]}
          </StatusBadge>
        </div>
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {chips.map((chip) => (
              <span key={chip} className="px-1.5 py-0.5 rounded-interactive bg-secondary/40 border border-primary/10 typo-label text-foreground">
                {chip}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 typo-label text-foreground">
          {cell.installedVersion
            ? tx(d.launch_installed_version, { version: cell.installedVersion })
            : cell.libraryVersion
              ? tx(d.launch_library_version, { version: cell.libraryVersion })
              : null}
        </div>
      </div>
      {cell.status === 'ready' && (
        <div className="mt-3 flex items-center gap-1.5 typo-caption font-medium text-primary">
          <Rocket className="w-3.5 h-3.5" aria-hidden />
          {d.launch_action_launch}
        </div>
      )}
    </>
  );

  const frame = 'rounded-card border p-4 text-left transition-colors h-full flex flex-col justify-between';

  if (cell.status === 'ready') {
    return (
      <button
        type="button"
        onClick={() => onLaunch(cell)}
        className={`${frame} border-primary/15 hover:border-primary/40 hover:bg-primary/5 cursor-pointer w-full`}
        data-testid={`launch-tile-${cell.project.id}`}
      >
        {body(false)}
      </button>
    );
  }

  if (cell.status === 'needs_adopt') {
    return (
      <div className={`${frame} border-primary/10`} data-testid={`launch-tile-${cell.project.id}`}>
        {body(true)}
        <div className="mt-3">
          <Tooltip content={d.launch_needs_adopt_hint}>
            <Button size="sm" variant="secondary" onClick={() => onAdopt(cell)}>
              {d.launch_action_adopt}
            </Button>
          </Tooltip>
        </div>
      </div>
    );
  }

  // adopting | running — inert, with the reason on hover.
  const hint = cell.status === 'adopting' ? d.launch_adopting_hint : d.launch_running_hint;
  return (
    <Tooltip content={hint}>
      <div
        className={`${frame} border-primary/10 opacity-60 cursor-not-allowed`}
        aria-disabled
        data-testid={`launch-tile-${cell.project.id}`}
      >
        {body(false)}
      </div>
    </Tooltip>
  );
}
