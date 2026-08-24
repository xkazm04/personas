// Circuit leaf — one project node card at the end of a wire. Fixed height
// (CircuitWires.NODE_H) so wire endpoints stay computed, not measured.
// Two-row layout by design: row 1 = identity (project name + status icons),
// row 2 = everything else (actions, versions, transient feedback).
import { ArrowDownToLine, CircleDashed, Loader2, Play, Radio } from 'lucide-react';

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

  const versionText = cell.installedVersion
    ? tx(d.launch_installed_version, { version: cell.installedVersion })
    : cell.libraryVersion
      ? tx(d.launch_library_version, { version: cell.libraryVersion })
      : null;

  const versions = versionText && (
    <span
      // muted-ok: structural micro-label (version chip, chrome not body copy)
      className="typo-caption text-foreground/40 truncate ml-auto"
    >
      {versionText}
    </span>
  );

  const nameRow = (icon: React.ReactNode) => (
    <span className="flex items-center gap-1.5 min-w-0 w-full">
      <span className="typo-body font-medium text-foreground truncate">{project.name}</span>
      <span className="ml-auto flex items-center gap-1 flex-shrink-0">{icon}</span>
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
        {nameRow(<Play className="w-3 h-3 text-status-success" aria-hidden />)}
        <span className="flex items-center gap-2 min-w-0 w-full">
          <span className={`typo-caption ${justSent ? 'text-status-success animate-fade-in' : 'text-status-success'}`}>
            {justSent ? d.launch_sent_to_athena : d.launch_action_launch}
          </span>
          {versions}
        </span>
      </button>
    );
  }

  if (status === 'needs_adopt') {
    return (
      <div style={style} className={`${frame} border-primary/10 bg-secondary/10 opacity-70`}>
        {nameRow(<CircleDashed className="w-3 h-3 text-foreground opacity-40" aria-hidden />)}
        <span className="flex items-center gap-2 min-w-0 w-full">
          <Tooltip content={d.launch_needs_adopt_hint}>
            <button
              type="button"
              onClick={onAdopt}
              aria-label={`${d.launch_action_adopt}: ${project.name}`}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-interactive typo-caption font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/20 transition-colors"
            >
              <ArrowDownToLine className="w-3 h-3" aria-hidden />
              {d.launch_action_adopt}
            </button>
          </Tooltip>
          {versions}
        </span>
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
        {nameRow(running
          ? <Radio className="w-3 h-3 text-status-info" aria-hidden />
          : <Loader2 className="w-3 h-3 text-status-warning" aria-hidden />)}
        <span className="flex items-center gap-2 min-w-0 w-full">
          <span className={`typo-caption ${running ? 'text-status-info' : 'text-status-warning'}`}>
            {running ? d.launch_status_running : d.launch_status_adopting}
          </span>
          {versions}
        </span>
      </button>
    </Tooltip>
  );
}
