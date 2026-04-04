import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Zap, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, Bot, Target, ArrowRight, ClipboardCheck,
  Brain, Play, Clock,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { listPersonas } from '@/api/agents/personas';
import { createTrigger, listTriggers, deleteTrigger } from '@/api/pipeline/triggers';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import { ProjectSelector } from '../DevToolsPage';
import GoalConstellation from './GoalConstellation';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';

// ---------------------------------------------------------------------------
// Flow step definitions
// ---------------------------------------------------------------------------

interface FlowStep {
  id: string;
  label: string;
  description: string;
  icon: typeof GitBranch;
  color: string;
  status: 'idle' | 'configured' | 'active' | 'error';
}

const REVIEW_APPROVED_EVENT = 'review_decision.approved';
const REVIEW_REJECTED_EVENT = 'review_decision.rejected';

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function LifecyclePage() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const goals = useSystemStore((s) => s.goals);
  const fetchGoals = useSystemStore((s) => s.fetchGoals);
  const addToast = useToastStore((s) => s.addToast);

  const [devClone, setDevClone] = useState<Persona | null>(null);
  const [triggers, setTriggers] = useState<PersonaTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [configuring, setConfiguring] = useState(false);

  // Discover dev-clone persona and its triggers
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const personas = await listPersonas();
      const clone = personas.find((p) =>
        p.name.toLowerCase().includes('dev clone') ||
        p.name.toLowerCase().includes('dev-clone')
      ) ?? null;
      setDevClone(clone);

      if (clone) {
        const t = await listTriggers(clone.id);
        setTriggers(t);
      }
    } catch {
      // Persona not created yet
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (activeProjectId) fetchGoals(activeProjectId);
  }, [activeProjectId, fetchGoals]);

  // Check which event listeners are configured
  const hasApprovedListener = triggers.some((t) => {
    if (t.trigger_type !== 'event_listener' || !t.config) return false;
    try {
      const cfg = JSON.parse(t.config);
      return cfg.listen_event_type === REVIEW_APPROVED_EVENT;
    } catch { return false; }
  });

  const hasRejectedListener = triggers.some((t) => {
    if (t.trigger_type !== 'event_listener' || !t.config) return false;
    try {
      const cfg = JSON.parse(t.config);
      return cfg.listen_event_type === REVIEW_REJECTED_EVENT;
    } catch { return false; }
  });

  const hasScheduleTrigger = triggers.some((t) => t.trigger_type === 'schedule');

  // Auto-configure all event listeners
  const handleAutoSetup = useCallback(async () => {
    if (!devClone) {
      addToast('No Dev Clone persona found. Create one from the dev-clone template first.', 'error');
      return;
    }

    setConfiguring(true);
    try {
      let created = 0;

      // Create approved listener if missing
      if (!hasApprovedListener) {
        await createTrigger({
          persona_id: devClone.id,
          trigger_type: 'event_listener',
          config: JSON.stringify({ listen_event_type: REVIEW_APPROVED_EVENT }),
          enabled: true,
          use_case_id: null,
        });
        created++;
      }

      // Create rejected listener if missing
      if (!hasRejectedListener) {
        await createTrigger({
          persona_id: devClone.id,
          trigger_type: 'event_listener',
          config: JSON.stringify({ listen_event_type: REVIEW_REJECTED_EVENT }),
          enabled: true,
          use_case_id: null,
        });
        created++;
      }

      // Create hourly schedule trigger if missing
      if (!hasScheduleTrigger) {
        await createTrigger({
          persona_id: devClone.id,
          trigger_type: 'schedule',
          config: JSON.stringify({
            cron: '0 * * * *',
            event_type: 'dev_clone.hourly_scan',
            payload: JSON.stringify({ mode: 'backlog_scan' }),
          }),
          enabled: true,
          use_case_id: null,
        });
        created++;
      }

      addToast(`Auto-setup complete: ${created} trigger(s) created.`, 'success');
      await refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Setup failed', 'error');
    } finally {
      setConfiguring(false);
    }
  }, [devClone, hasApprovedListener, hasRejectedListener, hasScheduleTrigger, addToast, refresh]);

  // Remove all Dev Clone triggers
  const handleTeardown = useCallback(async () => {
    if (!devClone) return;
    setConfiguring(true);
    try {
      for (const t of triggers) {
        await deleteTrigger(t.id, devClone.id);
      }
      addToast('All Dev Clone triggers removed.', 'success');
      await refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Teardown failed', 'error');
    } finally {
      setConfiguring(false);
    }
  }, [devClone, triggers, addToast, refresh]);

  // Build flow steps from current state
  const steps: FlowStep[] = [
    {
      id: 'persona',
      label: 'Dev Clone Persona',
      description: devClone ? `"${devClone.name}" ready` : 'Create from dev-clone template',
      icon: Bot,
      color: 'violet',
      status: devClone ? 'configured' : 'idle',
    },
    {
      id: 'schedule',
      label: 'Hourly Scan',
      description: hasScheduleTrigger ? 'Cron trigger active (0 * * * *)' : 'Periodic codebase analysis',
      icon: Clock,
      color: 'blue',
      status: hasScheduleTrigger ? 'active' : 'idle',
    },
    {
      id: 'goals',
      label: 'Goals',
      description: `${goals.length} goal(s) in project`,
      icon: Target,
      color: 'amber',
      status: goals.length > 0 ? 'configured' : 'idle',
    },
    {
      id: 'review',
      label: 'Human Review',
      description: 'Tasks proposed for approval',
      icon: ClipboardCheck,
      color: 'emerald',
      status: 'configured',
    },
    {
      id: 'approved',
      label: 'Approval → Build',
      description: hasApprovedListener ? 'Event listener active' : 'Triggers Dev Clone build cycle',
      icon: Play,
      color: 'emerald',
      status: hasApprovedListener ? 'active' : 'idle',
    },
    {
      id: 'rejected',
      label: 'Rejection → Recompose',
      description: hasRejectedListener ? 'Event listener active' : 'Triggers recomposition with feedback',
      icon: RefreshCw,
      color: 'red',
      status: hasRejectedListener ? 'active' : 'idle',
    },
    {
      id: 'memory',
      label: 'Memory Learning',
      description: 'Decisions auto-saved as learned memories',
      icon: Brain,
      color: 'violet',
      status: 'configured',
    },
  ];

  const allConfigured = devClone && hasApprovedListener && hasRejectedListener && hasScheduleTrigger;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Dev Lifecycle"
        subtitle="Autonomous development flow: scan → goals → review → build → learn"
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={refresh}
              disabled={loading}
            >
              Refresh
            </Button>
            {allConfigured ? (
              <Button
                variant="danger"
                size="sm"
                onClick={handleTeardown}
                loading={configuring}
              >
                Teardown
              </Button>
            ) : (
              <Button
                variant="accent"
                accentColor="violet"
                size="sm"
                icon={<Zap className="w-3.5 h-3.5" />}
                onClick={handleAutoSetup}
                loading={configuring}
                disabled={!devClone}
                disabledReason={!devClone ? 'Create a Dev Clone persona first' : undefined}
              >
                Auto-Setup
              </Button>
            )}
          </div>
        }
      >
        <ProjectSelector />
      </ContentHeader>

      <ContentBody centered>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading lifecycle status...
          </div>
        ) : (
          <div className="space-y-6 pb-6">
            {/* Overall status banner */}
            <div className={`rounded-xl border p-4 flex items-center gap-3 ${
              allConfigured
                ? 'border-emerald-500/20 bg-emerald-500/5'
                : 'border-amber-500/20 bg-amber-500/5'
            }`}>
              {allConfigured ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-amber-400 flex-shrink-0" />
              )}
              <div className="flex-1">
                <p className="text-md font-medium text-foreground/80">
                  {allConfigured
                    ? 'Autonomous lifecycle fully configured'
                    : 'Lifecycle needs configuration'}
                </p>
                <p className="text-md text-muted-foreground/60">
                  {allConfigured
                    ? 'Dev Clone will scan hourly, propose tasks for review, and build on approval.'
                    : `${steps.filter((s) => s.status === 'idle').length} step(s) need setup. Click Auto-Setup to configure all at once.`}
                </p>
              </div>
            </div>

            {/* Flow visualization */}
            <div className="space-y-3">
              {steps.map((step, i) => {
                const Icon = step.icon;
                const statusIcon = step.status === 'active'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : step.status === 'configured'
                  ? <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  : step.status === 'error'
                  ? <XCircle className="w-4 h-4 text-red-400" />
                  : <AlertCircle className="w-4 h-4 text-muted-foreground/30" />;

                return (
                  <div key={step.id}>
                    <div className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                      step.status === 'active'
                        ? 'border-emerald-500/20 bg-emerald-500/5'
                        : step.status === 'configured'
                        ? 'border-primary/15 bg-primary/5'
                        : 'border-primary/10 bg-card/30 opacity-60'
                    }`}>
                      <div className={`w-10 h-10 rounded-xl bg-${step.color}-500/15 border border-${step.color}-500/25 flex items-center justify-center flex-shrink-0`}>
                        <Icon className={`w-5 h-5 text-${step.color}-400`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-md font-medium text-foreground/80">{step.label}</p>
                        <p className="text-md text-muted-foreground/60">{step.description}</p>
                      </div>
                      {statusIcon}
                    </div>
                    {i < steps.length - 1 && (
                      <div className="flex items-center justify-center py-1">
                        <ArrowRight className="w-4 h-4 text-muted-foreground/20 rotate-90" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Trigger details */}
            {triggers.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-md font-semibold uppercase tracking-wider text-muted-foreground/60">
                  Active Triggers ({triggers.length})
                </h3>
                <div className="border border-primary/10 rounded-xl overflow-hidden">
                  {triggers.map((t) => {
                    let configLabel = t.trigger_type;
                    try {
                      const cfg = JSON.parse(t.config ?? '{}');
                      if (cfg.listen_event_type) configLabel = cfg.listen_event_type;
                      else if (cfg.cron) configLabel = `cron: ${cfg.cron}`;
                    } catch { /* use default */ }
                    return (
                      <div key={t.id} className="flex items-center gap-3 px-4 py-3 border-b border-primary/5 last:border-b-0">
                        <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        <span className="text-md text-foreground/70 flex-1">{t.trigger_type}</span>
                        <span className="text-md text-muted-foreground/50 font-mono">{configLabel}</span>
                        <span className={`rounded-full px-2 py-0.5 text-md font-medium border ${
                          t.enabled
                            ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25'
                            : 'bg-red-500/15 text-red-400 border-red-500/25'
                        }`}>
                          {t.enabled ? 'enabled' : 'disabled'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Goal Constellation */}
            {goals.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-md font-semibold uppercase tracking-wider text-muted-foreground/60">
                    Goal Constellation
                  </h3>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={async () => {
                      if (!activeProjectId) return;
                      try {
                        const result = await obsidianBrainPushGoals(activeProjectId);
                        addToast(`Goals synced to Obsidian: ${result.created} created, ${result.updated} updated`, 'success');
                      } catch {
                        addToast('Obsidian sync failed — configure vault in Obsidian Brain plugin first', 'error');
                      }
                    }}
                  >
                    Sync to Obsidian
                  </Button>
                </div>
                <GoalConstellation />
              </div>
            )}

            {/* How it works explanation */}
            <div className="rounded-xl border border-primary/10 bg-card/30 p-5 space-y-3">
              <h3 className="text-md font-semibold text-foreground/80">How the Autonomous Flow Works</h3>
              <div className="space-y-2 text-md text-muted-foreground/60">
                <p><strong className="text-foreground/70">1. Hourly Scan:</strong> Dev Clone analyzes the codebase, checks goals, finds TODOs, runs portfolio health checks, and proposes improvement tasks.</p>
                <p><strong className="text-foreground/70">2. Human Review:</strong> Proposed tasks arrive in the Approvals module. You accept or reject each one.</p>
                <p><strong className="text-foreground/70">3. On Approval:</strong> A <code className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">review_decision.approved</code> event fires, triggering Dev Clone to create a branch, implement changes, run tests, and open a PR.</p>
                <p><strong className="text-foreground/70">4. On Rejection:</strong> A <code className="px-1.5 py-0.5 rounded bg-red-500/10 text-red-400">review_decision.rejected</code> event fires, triggering Dev Clone to recompose its proposal using the reviewer feedback.</p>
                <p><strong className="text-foreground/70">5. Memory:</strong> Every approval and rejection is saved as a "learned" memory, progressively improving Dev Clone's judgment.</p>
              </div>
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
