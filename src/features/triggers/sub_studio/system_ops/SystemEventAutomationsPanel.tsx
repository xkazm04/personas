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
import Button from '@/features/shared/components/buttons/Button';

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

  // lastStatus vocabulary: ok | requested (delegated op emitted, outcome not yet
  // reported) | partial | held (approval mode) | failed. Only `ok` may read "ran".
  const runStatusLabel = (status: string | null) => {
    switch (status) {
      case 'failed': return st.automation_failed;
      case 'requested': return st.automation_requested;
      case 'partial': return st.automation_partial;
      case 'held': return st.automation_held;
      default: return st.automation_ran;
    }
  };

  if (automations.length === 0) return null;

  const projectName = (a: SystemOpAutomation) => {
    const pid = projectIdOf(a);
    return pid ? (projects.find((p) => p.id === pid)?.name ?? pid) : null;
  };

  return (
    <div className="mt-2 rounded-card border border-role-agent/20 bg-role-agent/[0.04]">
      <div className="flex items-center gap-2 px-4 py-2 border-b border-role-agent/15">
        <Cog className="w-3.5 h-3.5 text-role-agent" />
        <span className="typo-label text-ink-1">{st.automations_title}</span>
        <span className="typo-caption text-ink-2 tabular-nums">{automations.length}</span>
      </div>
      <ul className="divide-y divide-violet-500/10">
        {automations.map((a) => (
          <li key={a.id} className="flex items-center gap-3 px-4 py-2.5">
            <span className="w-7 h-7 rounded-input bg-surface-2 flex items-center justify-center shrink-0 text-role-agent">
              {a.triggerKind === 'schedule' ? <Clock className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <span className="typo-body text-ink-1 truncate">
                  {projectName(a) ?? a.opKind}
                </span>
                <span className="typo-caption font-mono text-ink-1 truncate">
                  {a.triggerKind === 'schedule' ? a.cron : a.listenEventType}
                </span>
              </div>
              <div className="typo-caption text-ink-2">
                {a.lastRunAt ? (
                  <>
                    {runStatusLabel(a.lastStatus)}{' '}
                    <RelativeTime timestamp={a.lastRunAt} />
                  </>
                ) : a.nextRunAt ? (
                  <>{st.automation_next} <RelativeTime timestamp={a.nextRunAt} /></>
                ) : st.automation_idle}
              </div>
            </div>
            <Button
              type="button"
              onClick={() => onRun(a.id)}
              tooltip={st.automation_run_now}
              aria-label={st.automation_run_now}
              variant="ghost"
              size="icon-sm"
              icon={<Play className="w-3.5 h-3.5" />}
            />
            <AccessibleToggle checked={a.enabled} onChange={() => onToggle(a.id, !a.enabled)} label={st.automation_enabled} size="sm" />
            <Button
              type="button"
              onClick={() => onDelete(a.id)}
              tooltip={st.automation_delete}
              aria-label={st.automation_delete}
              variant="ghost"
              size="icon-sm"
              icon={<Trash2 className="w-3.5 h-3.5" />}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
