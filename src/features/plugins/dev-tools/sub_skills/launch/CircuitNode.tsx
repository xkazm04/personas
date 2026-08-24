// Circuit leaf — one project node card at the end of a wire. Fixed height
// (CircuitWires.NODE_H) so wire endpoints stay computed, not measured.
import { Play, ArrowDownToLine } from 'lucide-react';

import { StatusBadge } from '@/features/shared/components/display/StatusBadge';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { NODE_H } from './CircuitWires';
import type { ProjectLaunchCell } from './launchTypes';

export default function CircuitNode({ cell, onLaunch, onAdopt, justSent }: {
  cell: ProjectLaunchCell;
  onLaunch: () => void;
  onAdopt: () => void;
  justSent: boolean;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { status, project } = cell;
  const style = { height: NODE_H };

  const versions = (
    // muted-ok: structural micro-label (version chip, chrome not body copy)
    <span className="typo-caption text-foreground/40 truncate">
      {cell.installedVersion
        ? tx(d.launch_installed_version, { version: cell.installedVersion })
        : cell.libraryVersion
          ? tx(d.launch_library_version, { version: cell.libraryVersion })
          : null}
    </span>
  );

  const frame = 'flex flex-col justify-center gap-1 rounded-card border px-3.5 text-left min-w-0 w-full transition-colors';

  if (status === 'ready') {
    return (
      <button
        type="button"
        style={style}
        onClick={onLaunch}
        aria-label={`${d.launch_action_launch}: ${project.name}`}
        className={`${frame} border-status-success/40 bg-secondary/25 hover:bg-secondary/40 cursor-pointer`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
          <Play className="w-3 h-3 text-status-success flex-shrink-0 ml-auto" aria-hidden />
        </span>
        <span className="typo-caption text-status-success">
          {justSent ? d.launch_sent_to_athena : d.launch_status_ready}
        </span>
        {versions}
      </button>
    );
  }

  if (status === 'needs_adopt') {
    return (
      <div style={style} className={`${frame} border-primary/10 bg-secondary/10 opacity-70`}>
        <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
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
      </div>
    );
  }

  const running = status === 'running';
  return (
    <Tooltip
      content={running ? d.launch_running_hint : d.launch_adopting_hint}
      triggerClassName="w-full"
    >
      <button
        // One-shot pulse when adopting begins: keyed remount replays the fade once.
        key={status}
        type="button"
        disabled
        style={style}
        aria-busy={!running}
        aria-label={`${d.launch_action_launch}: ${project.name}`}
        className={`${frame} ${running ? 'border-status-info/40' : 'border-status-warning/40 animate-fade-in'} bg-secondary/15 cursor-not-allowed`}
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
          <StatusBadge variant={running ? 'info' : 'warning'} size="sm" className="ml-auto flex-shrink-0">
            {running ? d.launch_status_running : d.launch_status_adopting}
          </StatusBadge>
        </span>
        {versions}
      </button>
    </Tooltip>
  );
}
