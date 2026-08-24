// Atlas leaf — one compact project tile inside a tech-stack band.
// Interaction contract: ready = launchable button; needs_adopt = dimmed with
// an enabled adopt affordance; adopting/running = disabled with hint tooltip.
import { Play, ArrowDownToLine } from 'lucide-react';

import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import type { ProjectLaunchCell } from './launchTypes';

export default function AtlasTile({ cell, onLaunch, onAdopt, justSent }: {
  cell: ProjectLaunchCell;
  onLaunch: () => void;
  onAdopt: () => void;
  justSent: boolean;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { status, project } = cell;

  const versions = (
    // muted-ok: structural micro-label (version chips, chrome not body copy)
    <div className="flex items-center gap-2 typo-caption text-foreground/40 min-w-0">
      {cell.installedVersion && <span className="truncate">{tx(d.launch_installed_version, { version: cell.installedVersion })}</span>}
      {cell.libraryVersion && <span className="truncate">{tx(d.launch_library_version, { version: cell.libraryVersion })}</span>}
    </div>
  );

  const frame = 'flex flex-col gap-1.5 rounded-card border px-3 py-2.5 text-left min-w-0 w-full transition-colors';

  if (status === 'ready') {
    return (
      <button
        type="button"
        onClick={onLaunch}
        aria-label={`${d.launch_action_launch}: ${project.name}`}
        className={`${frame} border-primary/15 bg-secondary/20 hover:bg-secondary/35 hover:border-primary/30 cursor-pointer`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
          <Play className="w-3 h-3 text-status-success flex-shrink-0 ml-auto" aria-hidden />
        </div>
        <span className="typo-caption text-status-success">
          {justSent ? d.launch_sent_to_athena : d.launch_status_ready}
        </span>
        {versions}
      </button>
    );
  }

  if (status === 'needs_adopt') {
    return (
      <div className={`${frame} border-primary/10 bg-secondary/10 opacity-70`}>
        <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
        <span className="typo-caption text-foreground/85">{d.launch_status_needs_adopt}</span>
        <Tooltip content={d.launch_needs_adopt_hint}>
          <button
            type="button"
            onClick={onAdopt}
            aria-label={`${d.launch_action_adopt}: ${project.name}`}
            className="inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors"
          >
            <ArrowDownToLine className="w-3 h-3" aria-hidden />
            {d.launch_action_adopt}
          </button>
        </Tooltip>
        {versions}
      </div>
    );
  }

  const running = status === 'running';
  const hint = running ? d.launch_running_hint : d.launch_adopting_hint;
  return (
    <Tooltip content={hint}>
      <div
        // One-shot pulse on entering adopting: keyed remount replays the fade once.
        key={status}
        className={`${frame} border-primary/10 bg-secondary/15 ${running ? '' : 'animate-fade-in'}`}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
          <StatusBadge
            variant={running ? 'info' : 'warning'}
            size="sm"
            className="ml-auto flex-shrink-0"
          >
            {running ? d.launch_status_running : d.launch_status_adopting}
          </StatusBadge>
        </div>
        <button
          type="button"
          disabled
          aria-busy={!running}
          aria-label={`${d.launch_action_launch}: ${project.name}`}
          className="self-start px-2 py-0.5 rounded-interactive typo-caption text-foreground disabled:opacity-40 border border-primary/10 cursor-not-allowed"
        >
          {d.launch_action_launch}
        </button>
        {versions}
      </div>
    </Tooltip>
  );
}
