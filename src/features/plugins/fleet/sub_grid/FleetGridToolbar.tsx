import { CheckCircle2, LayoutGrid, Play, Send, RefreshCw, ListTodo, ClipboardList } from 'lucide-react';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useTranslation } from '@/i18n/useTranslation';
import { FleetTokenSummaryBar } from './FleetTokenSummaryBar';

interface FleetGridToolbarProps {
  sessions: FleetSession[];
  liveCount: number;
  waitingCount: number;
  boundClaudeIds: string[];
  activeProject: { root_path: string } | null;
  spawning: boolean;
  onOpenGrid: () => void;
  onSpawn: () => void;
  onSpawnTask: () => void;
  onBroadcast: () => void;
  onHarvest: () => void;
  onRefresh: () => void;
}

/**
 * The band above the session list: the fleet's token glance and the all-clear
 * chip on the left, the page's actions on the right. The glance and the
 * actions each had a band of their own, with the buttons alone on the right
 * of an empty row.
 */
export function FleetGridToolbar(p: FleetGridToolbarProps) {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const { sessions } = p;

  const left = (
    <>
      <FleetTokenSummaryBar claudeSessionIds={p.boundClaudeIds} />
      {sessions.length > 0 && p.waitingCount === 0 && (
        <span
          data-testid="fleet-all-clear"
          className="inline-flex items-center gap-1.5 rounded-card border border-status-success/25 bg-status-success/10 px-2.5 py-0.5 typo-caption text-status-success"
        >
          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
          {f.all_clear}
        </span>
      )}
    </>
  );

  return (
    <ActionRow left={left} compact>
      <Button data-testid="fleet-grid-open" variant="secondary" size="sm" icon={<LayoutGrid className="w-3.5 h-3.5" />}
        disabled={p.liveCount === 0} onClick={p.onOpenGrid} title={f.grid_open_aria}>
        {f.view_grid}
      </Button>
      <Button data-testid="fleet-spawn" variant="primary" size="sm" icon={<Play className="w-3.5 h-3.5" />}
        disabled={!p.activeProject} loading={p.spawning} onClick={p.onSpawn}
        title={p.activeProject ? `Spawn at ${p.activeProject.root_path}` : 'Pick a project first'}>
        {p.spawning ? 'Spawning…' : 'Spawn'}
      </Button>
      <Button data-testid="fleet-spawn-task-open" variant="secondary" size="sm" icon={<ListTodo className="w-3.5 h-3.5" />}
        disabled={!p.activeProject} onClick={p.onSpawnTask} title={f.spawn_task_title}>
        {f.spawn_with_task}
      </Button>
      <Button data-testid="fleet-broadcast-open" variant="secondary" size="sm" icon={<Send className="w-3.5 h-3.5" />}
        disabled={sessions.filter((s) => s.state !== 'exited' && s.state !== 'hibernated').length === 0} onClick={p.onBroadcast}>
        Broadcast
      </Button>
      <Button data-testid="fleet-harvest-open" variant="secondary" size="sm" icon={<ClipboardList className="w-3.5 h-3.5" />}
        disabled={sessions.every((s) => s.state !== 'finished')} onClick={p.onHarvest} title={f.harvest_title}>
        {f.harvest_open}
      </Button>
      <Button data-testid="fleet-grid-refresh" variant="ghost" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={p.onRefresh}>
        Refresh
      </Button>
    </ActionRow>
  );
}
