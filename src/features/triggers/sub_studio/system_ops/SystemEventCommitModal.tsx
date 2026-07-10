/**
 * Configure-and-commit modal for a Chain Studio "System event" route. Opens
 * when the user patches `schedule|event → System event`; collects the op's
 * params (project) + the trigger config (cadence cron, or the event type to
 * listen for), then persists a real `SystemOpAutomation`. The Context Map
 * "Plan update" button creates the same shape directly (weekly default).
 */
import { useEffect, useMemo, useState } from 'react';
import { Cog, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { useAgentStore } from '@/stores/agentStore';
import { usePipelineStore } from '@/stores/pipelineStore';
import { useSystemStore } from '@/stores/systemStore';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import {
  createSystemOpAutomation, contextScanParamsJson, memoryReflectionParamsJson,
  OP_CONTEXT_SCAN, OP_MEMORY_REFLECTION,
} from '@/api/systemOps';

interface CadenceOption { id: string; cron: string }
const CADENCES: CadenceOption[] = [
  { id: 'weekly', cron: '0 3 * * 1' },
  { id: 'daily', cron: '0 3 * * *' },
  { id: 'hourly', cron: '0 * * * *' },
  { id: 'custom', cron: '' },
];

export function SystemEventCommitModal({
  open, onClose, opKind, triggerType, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  opKind: string;
  /** Studio source trigger type: 'schedule' or 'event_listener'. */
  triggerType: string;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const st = t.triggers.studio;
  const projects = useSystemStore((s) => s.projects);
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const addToast = useToastStore((s) => s.addToast);

  const isSchedule = triggerType === 'schedule';
  const isContextScan = opKind === OP_CONTEXT_SCAN;
  const isReflection = opKind === OP_MEMORY_REFLECTION;

  const personas = useAgentStore((s) => s.personas);
  const teams = usePipelineStore((s) => s.teams);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  useEffect(() => { if (open && isReflection) void fetchTeams(); }, [open, isReflection, fetchTeams]);

  const [projectId, setProjectId] = useState(() => activeProjectId ?? projects[0]?.id ?? '');
  const [cadence, setCadence] = useState('weekly');
  const [customCron, setCustomCron] = useState('0 3 * * 1');
  const [eventType, setEventType] = useState('');
  const [delta, setDelta] = useState(true);
  // Reflection scope: which pool of memories to consolidate.
  const [reflectScope, setReflectScope] = useState<'agent' | 'team'>('agent');
  const [reflectPersonaId, setReflectPersonaId] = useState('');
  const [reflectTeamId, setReflectTeamId] = useState('');

  const cron = useMemo(() => {
    if (!isSchedule) return undefined;
    return cadence === 'custom' ? customCron.trim() : CADENCES.find((c) => c.id === cadence)?.cron;
  }, [isSchedule, cadence, customCron]);

  const reflectTargetId = reflectScope === 'team' ? reflectTeamId : reflectPersonaId;
  const canCreate = (!isContextScan || !!projectId)
    && (!isReflection || !!reflectTargetId)
    && (isSchedule ? !!cron : !!eventType.trim());

  const handleCreate = async () => {
    const project = projects.find((p) => p.id === projectId);
    const reflectTargetName = reflectScope === 'team'
      ? teams.find((tm) => tm.id === reflectTeamId)?.name
      : personas.find((p) => p.id === reflectPersonaId)?.name;
    try {
      await createSystemOpAutomation({
        opKind,
        paramsJson: isReflection
          ? memoryReflectionParamsJson(reflectScope === 'team' ? { teamId: reflectTeamId } : { personaId: reflectPersonaId })
          : contextScanParamsJson(projectId, delta),
        triggerKind: isSchedule ? 'schedule' : 'event',
        cron: isSchedule ? cron : undefined,
        listenEventType: isSchedule ? undefined : eventType.trim(),
        label: isReflection
          ? (reflectTargetName ? `${st.reflection_label} — ${reflectTargetName}` : st.reflection_label)
          : project ? `${st.system_event_label} — ${project.name}` : undefined,
      });
      addToast(st.commit_created_toast, 'success');
      onCreated();
      onClose();
    } catch (err) {
      toastCatch('SystemEventCommitModal:create', st.commit_failed_toast)(err);
    }
  };

  if (!open) return null;

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="system-event-commit" size="sm">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <Cog className="w-4 h-4 text-violet-400" />
          <h2 id="system-event-commit" className="typo-heading text-foreground flex-1">{st.system_event_commit_title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.cancel} className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {isContextScan && (
            <div className="space-y-1.5">
              <label className="typo-caption font-medium text-foreground">{st.commit_project_label}</label>
              {projects.length === 0 ? (
                <p className="typo-caption text-foreground">{st.commit_no_projects}</p>
              ) : (
                <ThemedSelect value={projectId} onValueChange={setProjectId}>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </ThemedSelect>
              )}
            </div>
          )}

          {isReflection && (
            <div className="space-y-1.5">
              <label className="typo-caption font-medium text-foreground">{st.reflect_scope_label}</label>
              <div className="grid grid-cols-2 gap-2">
                <ThemedSelect value={reflectScope} onValueChange={(v) => setReflectScope(v === 'team' ? 'team' : 'agent')}>
                  <option value="agent">{st.reflect_scope_agent}</option>
                  <option value="team">{st.reflect_scope_team}</option>
                </ThemedSelect>
                {reflectScope === 'agent' ? (
                  <ThemedSelect value={reflectPersonaId} onValueChange={setReflectPersonaId}>
                    <option value="">{st.reflect_pick_agent}</option>
                    {personas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </ThemedSelect>
                ) : (
                  <ThemedSelect value={reflectTeamId} onValueChange={setReflectTeamId}>
                    <option value="">{st.reflect_pick_team}</option>
                    {teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}</option>)}
                  </ThemedSelect>
                )}
              </div>
              <p className="typo-caption text-foreground opacity-70">{st.reflect_scope_hint}</p>
            </div>
          )}

          {isSchedule ? (
            <div className="space-y-1.5">
              <label className="typo-caption font-medium text-foreground">{st.commit_cadence_label}</label>
              <ThemedSelect value={cadence} onValueChange={setCadence}>
                <option value="weekly">{st.cadence_weekly}</option>
                <option value="daily">{st.cadence_daily}</option>
                <option value="hourly">{st.cadence_hourly}</option>
                <option value="custom">{st.cadence_custom}</option>
              </ThemedSelect>
              {cadence === 'custom' && (
                <input
                  value={customCron}
                  onChange={(e) => setCustomCron(e.target.value)}
                  placeholder="0 3 * * 1"
                  className="w-full px-3 py-2 typo-body font-mono bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/40 focus-ring"
                />
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="typo-caption font-medium text-foreground">{st.commit_event_label}</label>
              <input
                value={eventType}
                onChange={(e) => setEventType(e.target.value)}
                placeholder={st.commit_event_placeholder}
                className="w-full px-3 py-2 typo-body font-mono bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/40 focus-ring"
              />
            </div>
          )}

          {isContextScan && (
            <div className="flex items-center justify-between gap-3">
              <span className="typo-caption text-foreground">{st.commit_delta_label}</span>
              <AccessibleToggle checked={delta} onChange={() => setDelta((v) => !v)} label={st.commit_delta_label} size="sm" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton variant="accent" accentColor="violet" size="sm" onClick={handleCreate} disabled={!canCreate}>
            {st.commit_create}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
