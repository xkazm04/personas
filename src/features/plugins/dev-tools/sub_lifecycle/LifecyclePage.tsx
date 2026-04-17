import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Zap, RefreshCw, Settings, Target, Swords,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { listPersonas } from '@/api/agents/personas';
import { createTrigger, listTriggers, deleteTrigger } from '@/api/pipeline/triggers';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { SetupTab } from './tabs/SetupTab';
import { GoalsTab } from './tabs/GoalsTab';
import { CompetitionsTab } from './tabs/CompetitionsTab';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type LifecycleTab = 'setup' | 'goals' | 'competitions';

const TABS: { id: LifecycleTab; label: string; icon: typeof Settings }[] = [
  { id: 'setup', label: 'Lifecycle Setup', icon: Settings },
  { id: 'goals', label: 'Goal Constellation', icon: Target },
  { id: 'competitions', label: 'Competitions', icon: Swords },
];

const REVIEW_APPROVED_EVENT = 'review_decision.approved';
const REVIEW_REJECTED_EVENT = 'review_decision.rejected';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseListenerConfig(trigger: PersonaTrigger, event: string): boolean {
  if (trigger.trigger_type !== 'event_listener' || !trigger.config) return false;
  try { return JSON.parse(trigger.config).listen_event_type === event; }
  catch { return false; }
}

// ---------------------------------------------------------------------------
// Main Page — thin shell with tab menu
// ---------------------------------------------------------------------------

export default function LifecyclePage() {
  const { t } = useTranslation();
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
  const goals = useSystemStore((s) => s.goals);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const addToast = useToastStore((s) => s.addToast);

  const [tab, setTab] = useState<LifecycleTab>('setup');
  const [devClone, setDevClone] = useState<Persona | null>(null);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const personas = await listPersonas();
      const clone = personas.find((p) => {
        const n = p.name.toLowerCase();
        return n.includes('dev clone') || n.includes('dev-clone');
      }) ?? null;
      setDevClone(clone);
      setTriggers(clone ? await listTriggers(clone.id) : []);
    } catch { /* not created yet */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (activeProjectId) fetchGoals(activeProjectId); }, [activeProjectId, fetchGoals]);

  const hasApproved = triggers.some((tr) => parseListenerConfig(tr, REVIEW_APPROVED_EVENT));
  const hasRejected = triggers.some((tr) => parseListenerConfig(tr, REVIEW_REJECTED_EVENT));
  const hasSchedule = triggers.some((tr) => tr.trigger_type === 'schedule');
  const allConfigured = Boolean(devClone && hasApproved && hasRejected && hasSchedule);

  const handleAutoSetup = useCallback(async () => {
    if (!devClone) { addToast('Adopt Dev Clone first.', 'error'); return; }
    setConfiguring(true);
    try {
      let n = 0;
      if (!hasApproved) { await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_APPROVED_EVENT }), enabled: true, use_case_id: null }); n++; }
      if (!hasRejected) { await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_REJECTED_EVENT }), enabled: true, use_case_id: null }); n++; }
      if (!hasSchedule) { await createTrigger({ persona_id: devClone.id, trigger_type: 'schedule', config: JSON.stringify({ cron: '0 * * * *', event_type: 'dev_clone.hourly_scan', payload: JSON.stringify({ mode: 'backlog_scan' }) }), enabled: true, use_case_id: null }); n++; }
      addToast(`Auto-setup complete: ${n} trigger(s) created.`, 'success');
      await refresh();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Setup failed', 'error'); }
    finally { setConfiguring(false); }
  }, [devClone, hasApproved, hasRejected, hasSchedule, addToast, refresh]);

  const handleTeardown = useCallback(async () => {
    if (!devClone) return;
    setConfiguring(true);
    try {
      for (const tr of triggers) await deleteTrigger(tr.id, devClone.id);
      addToast('All Dev Clone triggers removed.', 'success');
      await refresh();
    } catch (err) { addToast(err instanceof Error ? err.message : 'Teardown failed', 'error'); }
    finally { setConfiguring(false); }
  }, [devClone, triggers, addToast, refresh]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_tools.lifecycle_title}
        actions={
          <div className="flex items-center gap-2">
            <LifecycleProjectPicker />
            <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={refresh} disabled={loading}>Refresh</Button>
            {allConfigured ? (
              <Button variant="danger" size="sm" onClick={handleTeardown} loading={configuring}>Teardown</Button>
            ) : (
              <Button variant="accent" accentColor="violet" size="sm" icon={<Zap className="w-3.5 h-3.5" />}
                onClick={handleAutoSetup} loading={configuring} disabled={!devClone}
                disabledReason={!devClone ? 'Adopt Dev Clone first' : undefined}>{t.plugins.dev_tools.auto_setup}</Button>
            )}
          </div>
        }
      >
        {/* Tab menu below header */}
        <div className="flex items-center gap-1 mt-3">
          {TABS.map((tabItem) => {
            const Icon = tabItem.icon;
            return (
              <button key={tabItem.id} onClick={() => setTab(tabItem.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-interactive typo-heading transition-colors ${
                  tab === tabItem.id
                    ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                    : 'text-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent'
                }`}>
                <Icon className="w-4 h-4" />
                {tabItem.label}
              </button>
            );
          })}
        </div>
      </ContentHeader>

      <ContentBody centered>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="typo-body">{t.plugins.dev_tools.loading_lifecycle}</span>
          </div>
        ) : (
          <>
            {tab === 'setup' && (
              <SetupTab
                devClone={devClone} triggers={triggers}
                activeProject={activeProject ? { name: activeProject.name, root_path: activeProject.root_path, github_url: activeProject.github_url } : null}
                goalCount={goals.length}
                hasApprovedListener={hasApproved} hasRejectedListener={hasRejected}
                hasScheduleTrigger={hasSchedule} loading={loading} onRefresh={refresh}
              />
            )}
            {tab === 'goals' && <GoalsTab />}
            {tab === 'competitions' && <CompetitionsTab />}
          </>
        )}
      </ContentBody>
    </ContentBox>
  );
}
