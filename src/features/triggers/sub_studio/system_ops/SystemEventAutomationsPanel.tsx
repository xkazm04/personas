/**
 * Compact list of committed system-event automations (Chain Studio). Each row
 * is a persisted `schedule|event → system op` route with enable/run/delete and
 * a last-run status. Distinct from the persona-route ledger above it.
 */
import { Cog, Clock, Radio, Play, Trash2 } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { SystemOpAutomation } from '@/api/systemOps';

function projectIdOf(a: SystemOpAutomation): string | null {
  try { return (JSON.parse(a.paramsJson) as { projectId?: string }).projectId ?? null; }
  catch { return null; }
}

export function SystemEventAutomationsPanel({
  automations, onToggle, onRun, onDelete,
}: {
  automations: SystemOpAutomation[];
  onToggle: (id: string, enabled: boolean) => void;
  onRun: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const st = t.triggers.studio;
  const projects = useSystemStore((s) => s.projects);

  if (automations.length === 0) return null;

  const projectName = (a: SystemOpAutomation) => {
    const pid = projectIdOf(a);
    return pid ? (projects.find((p) => p.id === pid)?.name ?? pid) : null;
  };

  return (
    <div className="mt-2 rounded-card border border-violet-500/20 bg-violet-500/[0.04]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-violet-500/15">
        <Cog className="w-3.5 h-3.5 text-violet-400" />
        <span className="typo-label text-foreground">{st.automations_title}</span>
        <span className="typo-caption text-foreground tabular-nums">{automations.length}</span>
      </div>
      <ul className="divide-y divide-violet-500/10">
        {automations.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-7 h-7 rounded-input bg-secondary/60 flex items-center justify-center shrink-0 text-violet-400">
              {a.triggerKind === 'schedule' ? <Clock className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="typo-body font-medium text-foreground truncate">
                  {projectName(a) ?? a.opKind}
                </span>
                <span className="typo-caption font-mono text-foreground truncate">
                  {a.triggerKind === 'schedule' ? a.cron : a.listenEventType}
                </span>
              </div>
              <div className="typo-caption text-foreground">
                {a.lastRunAt ? (
                  <>
                    {a.lastStatus === 'failed' ? st.automation_failed : st.automation_ran}{' '}
                    <RelativeTime timestamp={a.lastRunAt} />
                  </>
                ) : a.nextRunAt ? (
                  <>{st.automation_next} <RelativeTime timestamp={a.nextRunAt} /></>
                ) : st.automation_idle}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRun(a.id)}
              title={st.automation_run_now}
              aria-label={st.automation_run_now}
              className="p-1.5 rounded-interactive text-foreground hover:text-violet-400 hover:bg-violet-500/10 transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
            </button>
            <AccessibleToggle checked={a.enabled} onChange={() => onToggle(a.id, !a.enabled)} label={st.automation_enabled} size="sm" />
            <button
              type="button"
              onClick={() => onDelete(a.id)}
              title={st.automation_delete}
              aria-label={st.automation_delete}
              className="p-1.5 rounded-interactive text-foreground hover:text-status-error hover:bg-status-error/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
