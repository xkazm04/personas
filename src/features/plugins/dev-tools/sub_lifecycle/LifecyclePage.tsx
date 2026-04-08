import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  GitBranch, Zap, CheckCircle2, XCircle, AlertCircle,
  RefreshCw, Bot, Target, ArrowRight, ClipboardCheck,
  Brain, Play, Clock, Download, FolderKanban,
  ShieldCheck, Sparkles,
} from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { listPersonas } from '@/api/agents/personas';
import { createTrigger, listTriggers, deleteTrigger } from '@/api/pipeline/triggers';
import { useToastStore } from '@/stores/toastStore';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import GoalConstellation from './GoalConstellation';
import { obsidianBrainPushGoals } from '@/api/obsidianBrain';
import { LifecycleProjectPicker } from './LifecycleProjectPicker';
import { useDevCloneAdoption } from './useDevCloneAdoption';
import { CompetitionPanel } from './CompetitionPanel';

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

// Vibeman-inspired quality gates — numeric confidence score for lifecycle config.
interface QualityGate {
  id: string;
  label: string;
  ok: boolean;
  weight: number;
  hint?: string;
}

// ---------------------------------------------------------------------------
// Empty-state adoption card — shown when no Dev Clone persona exists
// ---------------------------------------------------------------------------

function DevCloneAdoptionCard({
  onAdopted,
  activeProjectName,
  activeProjectHasGithub,
  activeProjectRootPath,
}: {
  onAdopted: () => void;
  activeProjectName: string | null;
  activeProjectHasGithub: boolean;
  activeProjectRootPath: string | null;
}) {
  const { adoptDevClone, adopting } = useDevCloneAdoption();

  const handleAdopt = useCallback(async () => {
    const persona = await adoptDevClone();
    if (persona) onAdopted();
  }, [adoptDevClone, onAdopted]);

  return (
    <div className="rounded-card border border-primary/15 bg-gradient-to-br from-violet-500/8 via-primary/5 to-transparent p-6">
      <div className="flex items-start gap-4 mb-4">
        <div className="w-12 h-12 rounded-card bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
          <Bot className="w-6 h-6 text-violet-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
            Adopt Dev Clone
          </h3>
          <p className="typo-body text-foreground mt-1">
            Dev Clone is an autonomous developer persona bundled with Personas.
            It scans your codebase every hour, proposes tasks for review, and builds
            on approval. Adopting the template creates the persona, registers its
            tools, and wires its triggers in a single step.
          </p>
        </div>
      </div>

      {/* Prerequisites checklist */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-5">
        <PrereqRow
          icon={FolderKanban}
          ok={Boolean(activeProjectName)}
          title="Dev project"
          value={activeProjectName ?? 'none selected'}
          hint={activeProjectRootPath ?? undefined}
        />
        <PrereqRow
          icon={GitBranch}
          ok={activeProjectHasGithub}
          title="GitHub repo"
          value={activeProjectHasGithub ? 'linked' : 'not linked'}
          hint={activeProjectHasGithub ? undefined : 'Needed for PR workflows'}
        />
        <PrereqRow
          icon={Download}
          ok
          title="Dev Clone template"
          value="bundled"
          hint="From scripts/templates/development/dev-clone.json"
        />
      </div>

      <div className="flex items-center gap-3">
        <Button
          variant="accent"
          accentColor="violet"
          size="md"
          icon={<Sparkles className="w-4 h-4" />}
          loading={adopting}
          disabled={!activeProjectName}
          disabledReason={!activeProjectName ? 'Select a project first' : undefined}
          onClick={handleAdopt}
        >
          Adopt Dev Clone
        </Button>
        {!activeProjectHasGithub && activeProjectName && (
          <p className="typo-caption text-foreground">
            You can still adopt now — add the GitHub URL to the project later to enable PR workflows.
          </p>
        )}
      </div>
    </div>
  );
}

function PrereqRow({
  icon: Icon,
  ok,
  title,
  value,
  hint,
}: {
  icon: typeof FolderKanban;
  ok: boolean;
  title: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={`rounded-interactive border p-3 ${
      ok ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-amber-500/25 bg-amber-500/5'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${ok ? 'text-emerald-400' : 'text-amber-400'}`} />
        <span className="typo-caption text-foreground">{title}</span>
        {ok ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 ml-auto" />
        ) : (
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 ml-auto" />
        )}
      </div>
      <p className="typo-body text-foreground truncate">{value}</p>
      {hint && <p className="typo-caption text-foreground truncate mt-0.5">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function LifecyclePage() {
  const activeProjectId = useSystemStore((s) => s.activeProjectId);
  const activeProject = useSystemStore((s) =>
    s.projects.find((p) => p.id === s.activeProjectId),
  );
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
      } else {
        setTriggers([]);
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

  // Check which triggers are configured
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
  const hasGithub = Boolean(activeProject?.github_url);

  // Auto-configure all event listeners
  const handleAutoSetup = useCallback(async () => {
    if (!devClone) {
      addToast('Adopt Dev Clone first.', 'error');
      return;
    }

    setConfiguring(true);
    try {
      let created = 0;

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
      description: devClone ? `"${devClone.name}" ready` : 'Adopt from bundled template',
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

  // Vibeman-inspired quality gates: compute a 0-100 readiness score
  const gates: QualityGate[] = useMemo(() => [
    { id: 'project', label: 'Dev project selected', ok: Boolean(activeProject), weight: 15, hint: 'Choose a project in the header' },
    { id: 'github', label: 'GitHub repo linked', ok: hasGithub, weight: 15, hint: 'Required for PR workflows' },
    { id: 'persona', label: 'Dev Clone adopted', ok: Boolean(devClone), weight: 25, hint: 'Create from bundled template' },
    { id: 'schedule', label: 'Hourly scan scheduled', ok: hasScheduleTrigger, weight: 15, hint: 'Auto-setup creates this' },
    { id: 'approved', label: 'Approval listener wired', ok: hasApprovedListener, weight: 15, hint: 'Auto-setup creates this' },
    { id: 'rejected', label: 'Rejection listener wired', ok: hasRejectedListener, weight: 15, hint: 'Auto-setup creates this' },
  ], [activeProject, hasGithub, devClone, hasScheduleTrigger, hasApprovedListener, hasRejectedListener]);

  const qualityScore = useMemo(
    () => gates.reduce((acc, g) => acc + (g.ok ? g.weight : 0), 0),
    [gates],
  );

  const allConfigured = Boolean(
    devClone && hasApprovedListener && hasRejectedListener && hasScheduleTrigger,
  );

  const missingPersona = !loading && !devClone;

  return (
    <ContentBox>
      <ContentHeader
        icon={<GitBranch className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Dev Lifecycle"
        subtitle="Autonomous development flow: scan → goals → review → build → learn"
        actions={
          <div className="flex items-center gap-2">
            <LifecycleProjectPicker />
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
                disabledReason={!devClone ? 'Adopt Dev Clone first' : undefined}
              >
                Auto-Setup
              </Button>
            )}
          </div>
        }
      />

      <ContentBody centered>
        {loading ? (
          <div className="flex items-center justify-center py-20 text-foreground">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="typo-body">Loading lifecycle status...</span>
          </div>
        ) : (
          <div className="space-y-6 pb-6">
            {/* Quality gates summary — Vibeman-inspired readiness score */}
            <div className={`rounded-card border p-4 ${
              qualityScore >= 85
                ? 'border-emerald-500/25 bg-emerald-500/5'
                : qualityScore >= 55
                ? 'border-amber-500/25 bg-amber-500/5'
                : 'border-red-500/25 bg-red-500/5'
            }`}>
              <div className="flex items-center gap-3 mb-3">
                <ShieldCheck className={`w-5 h-5 shrink-0 ${
                  qualityScore >= 85 ? 'text-emerald-400' :
                  qualityScore >= 55 ? 'text-amber-400' : 'text-red-400'
                }`} />
                <div className="flex-1 min-w-0">
                  <h3 className="typo-heading text-primary text-[14px] [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
                    Lifecycle Readiness — {qualityScore}/100
                  </h3>
                  <p className="typo-body text-foreground mt-0.5">
                    {qualityScore >= 85
                      ? 'Ready to run. Dev Clone will scan, propose, and build on approval.'
                      : qualityScore >= 55
                      ? 'Partially configured. Click Auto-Setup to fill the gaps.'
                      : 'Not configured yet. Adopt Dev Clone and run Auto-Setup.'}
                  </p>
                </div>
                <div className="shrink-0">
                  <div className="w-24 h-2 rounded-full bg-background/60 overflow-hidden">
                    <div
                      className={`h-full transition-all ${
                        qualityScore >= 85 ? 'bg-emerald-400' :
                        qualityScore >= 55 ? 'bg-amber-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${qualityScore}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {gates.map((g) => (
                  <div key={g.id} className="flex items-center gap-2">
                    {g.ok ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-foreground/40 shrink-0" />
                    )}
                    <span className="typo-caption text-foreground truncate" title={g.hint}>
                      {g.label}
                    </span>
                    <span className="typo-caption text-foreground/50 shrink-0 ml-auto">
                      +{g.weight}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Adoption CTA — shown when Dev Clone persona does not exist */}
            {missingPersona && (
              <DevCloneAdoptionCard
                onAdopted={refresh}
                activeProjectName={activeProject?.name ?? null}
                activeProjectHasGithub={hasGithub}
                activeProjectRootPath={activeProject?.root_path ?? null}
              />
            )}

            {/* Flow visualization */}
            {/* Compact flow list — one row per step, no inter-row dividers */}
            <div className="rounded-card border border-primary/15 overflow-hidden divide-y divide-primary/10">
              {steps.map((step) => {
                const Icon = step.icon;
                const statusIcon = step.status === 'active'
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  : step.status === 'configured'
                  ? <CheckCircle2 className="w-4 h-4 text-blue-400" />
                  : step.status === 'error'
                  ? <XCircle className="w-4 h-4 text-red-400" />
                  : <AlertCircle className="w-4 h-4 text-foreground/40" />;

                return (
                  <div
                    key={step.id}
                    className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${
                      step.status === 'active'
                        ? 'bg-emerald-500/5'
                        : step.status === 'configured'
                        ? 'bg-primary/5'
                        : 'bg-card/20 opacity-75'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-interactive bg-${step.color}-500/15 border border-${step.color}-500/25 flex items-center justify-center flex-shrink-0`}>
                      <Icon className={`w-4 h-4 text-${step.color}-400`} />
                    </div>
                    <span className="typo-heading text-primary [text-shadow:_0_0_8px_color-mix(in_oklab,var(--primary)_35%,transparent)] shrink-0">
                      {step.label}
                    </span>
                    <span className="typo-body text-foreground/50 shrink-0">·</span>
                    <span className="typo-body text-foreground truncate flex-1 min-w-0">
                      {step.description}
                    </span>
                    {statusIcon}
                  </div>
                );
              })}
            </div>

            {/* Trigger details */}
            {triggers.length > 0 && (
              <div className="space-y-2">
                <h3 className="typo-caption text-foreground uppercase tracking-wider">
                  Active Triggers ({triggers.length})
                </h3>
                <div className="border border-primary/15 rounded-card overflow-hidden">
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
                        <span className="typo-body text-foreground flex-1">{t.trigger_type}</span>
                        <span className="typo-code text-foreground">{configLabel}</span>
                        <span className={`rounded-full px-2 py-0.5 typo-caption font-medium border ${
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
                  <h3 className="typo-caption text-foreground uppercase tracking-wider">
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

            {/* Competitions (experimental multi-clone MVP) */}
            <CompetitionPanel />

            {/* How it works explanation */}
            <div className="rounded-card border border-primary/15 bg-card/40 p-5 space-y-3">
              <h3 className="typo-heading text-primary [text-shadow:_0_0_10px_color-mix(in_oklab,var(--primary)_35%,transparent)]">
                How the Autonomous Flow Works
              </h3>
              <div className="space-y-2 typo-body text-foreground">
                <p>
                  <strong className="text-primary">1. Hourly Scan:</strong> Dev Clone analyzes the
                  codebase, checks goals, finds TODOs, runs portfolio health checks, and proposes
                  improvement tasks.
                </p>
                <p>
                  <strong className="text-primary">2. Human Review:</strong> Proposed tasks arrive in
                  the Approvals module. You accept or reject each one.
                </p>
                <p>
                  <strong className="text-primary">3. On Approval:</strong> A{' '}
                  <code className="px-1.5 py-0.5 rounded-interactive bg-emerald-500/10 text-emerald-400 typo-code">
                    review_decision.approved
                  </code>{' '}
                  event fires, triggering Dev Clone to create a branch, implement changes, run tests,
                  and open a PR.
                </p>
                <p>
                  <strong className="text-primary">4. On Rejection:</strong> A{' '}
                  <code className="px-1.5 py-0.5 rounded-interactive bg-red-500/10 text-red-400 typo-code">
                    review_decision.rejected
                  </code>{' '}
                  event fires, triggering Dev Clone to recompose its proposal using the reviewer
                  feedback.
                </p>
                <p>
                  <strong className="text-primary">5. Memory:</strong> Every approval and rejection
                  is saved as a "learned" memory, progressively improving Dev Clone's judgment.
                </p>
              </div>
            </div>
          </div>
        )}
      </ContentBody>
    </ContentBox>
  );
}
