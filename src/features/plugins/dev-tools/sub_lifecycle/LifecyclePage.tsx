import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Zap, RefreshCw, Settings, Swords, Activity,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
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
import { CompetitionsTab } from './tabs/CompetitionsTab';
import { ProjectTrackingTab } from './tabs/ProjectTrackingTab';
import { silentCatch } from '@/lib/silentCatch';


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type LifecycleTab = 'setup' | 'competitions' | 'tracking';

const TAB_DEFS: { id: LifecycleTab; labelKey: 'tab_setup' | 'tab_competitions' | 'tab_tracking'; icon: typeof Settings }[] = [
  { id: 'setup', labelKey: 'tab_setup', icon: Settings },
  { id: 'competitions', labelKey: 'tab_competitions', icon: Swords },
  { id: 'tracking', labelKey: 'tab_tracking', icon: Activity },
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
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
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
    } catch (err) { silentCatch("features/plugins/dev-tools/sub_lifecycle/LifecyclePage:catch1")(err); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (activeProjectId) fetchGoals(activeProjectId); }, [activeProjectId, fetchGoals]);

  // Consume any pending sub-tab handoff. Read once on mount and clear so a
  // stale value can't survive an unmount/remount race.
  useEffect(() => {
    const pending = useSystemStore.getState().pendingLifecycleSubTab;
    if (pending) setTab(pending);
    useSystemStore.getState().setPendingLifecycleSubTab(null);
  }, []);

  const hasApproved = triggers.some((tr) => parseListenerConfig(tr, REVIEW_APPROVED_EVENT));
  const hasRejected = triggers.some((tr) => parseListenerConfig(tr, REVIEW_REJECTED_EVENT));
  const hasSchedule = triggers.some((tr) => tr.trigger_type === 'schedule');
  const allConfigured = Boolean(devClone && hasApproved && hasRejected && hasSchedule);

  const handleAutoSetup = useCallback(async () => {
    if (!devClone) { addToast(dl.adopt_first_period, 'error'); return; }
    setConfiguring(true);
    try {
      let n = 0;
      if (!hasApproved) { await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_APPROVED_EVENT }), enabled: true, use_case_id: null }); n++; }
      if (!hasRejected) { await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_REJECTED_EVENT }), enabled: true, use_case_id: null }); n++; }
      if (!hasSchedule) { await createTrigger({ persona_id: devClone.id, trigger_type: 'schedule', config: JSON.stringify({ cron: '0 * * * *', event_type: 'dev_clone.hourly_scan', payload: JSON.stringify({ mode: 'backlog_scan' }) }), enabled: true, use_case_id: null }); n++; }
      addToast(tx(dl.auto_setup_complete, { n }), 'success');
      await refresh();
    } catch (err) { addToast(err instanceof Error ? err.message : dl.setup_failed, 'error'); }
    finally { setConfiguring(false); }
  }, [devClone, hasApproved, hasRejected, hasSchedule, addToast, refresh, dl, tx]);

  const handleTeardown = useCallback(async () => {
    if (!devClone) return;
    setConfiguring(true);
    try {
      for (const tr of triggers) await deleteTrigger(tr.id, devClone.id);
      addToast(dl.triggers_removed, 'success');
      await refresh();
    } catch (err) { addToast(err instanceof Error ? err.message : dl.teardown_failed, 'error'); }
    finally { setConfiguring(false); }
  }, [devClone, triggers, addToast, refresh, dl]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={t.plugins.dev_tools.lifecycle_title}
        subtitle={activeProject?.root_path ?? '—'}
        actions={<LifecycleProjectPicker />}
      />

      {/* Tab strip — lives outside the header so the header card stays
          dedicated to identity (title + path + project picker). The strip
          sits flush against the top of the body but is its own row so the
          header doesn't grow visually with each new tab. */}
      <LifecycleTabStrip tab={tab} onChange={setTab} />

      <ContentBody centered>
        <ActionRow>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={refresh} disabled={loading}>{t.common.refresh}</Button>
          {allConfigured ? (
            <Button variant="danger" size="sm" onClick={handleTeardown} loading={configuring}>{t.plugins.dev_tools.teardown}</Button>
          ) : (
            <Button variant="accent" accentColor="violet" size="sm" icon={<Zap className="w-3.5 h-3.5" />}
              onClick={handleAutoSetup} loading={configuring} disabled={!devClone}
              disabledReason={!devClone ? t.plugins.dev_tools.adopt_first : undefined}>{t.plugins.dev_tools.auto_setup}</Button>
          )}
        </ActionRow>

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
            {tab === 'competitions' && <CompetitionsTab />}
            {tab === 'tracking' && <ProjectTrackingTab />}
          </>
        )}
      </ContentBody>
    </ContentBox>
  );
}

// ---------------------------------------------------------------------------
// Tab strip — extracted so the ContentHeader card stays dedicated to
// project identity. Lives between header and body as its own row.
// ---------------------------------------------------------------------------

function LifecycleTabStrip({
  tab,
  onChange,
}: {
  tab: LifecycleTab;
  onChange: (next: LifecycleTab) => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  return (
    <div
      role="tablist"
      aria-label={t.plugins.dev_tools.lifecycle_title}
      className="flex items-center gap-1 px-4 pt-3 pb-2 border-b border-primary/5"
    >
      {TAB_DEFS.map((tabItem) => {
        const Icon = tabItem.icon;
        const active = tab === tabItem.id;
        return (
          <button
            key={tabItem.id}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(tabItem.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-interactive typo-heading transition-colors ${
              active
                ? 'bg-violet-500/10 text-violet-400 border border-violet-500/20'
                : 'text-foreground hover:bg-secondary/40 hover:text-foreground border border-transparent'
            }`}
          >
            <Icon className="w-4 h-4" />
            {dl[tabItem.labelKey]}
          </button>
        );
      })}
    </div>
  );
}
