/**
 * Mission Control — linear "launch sequence" variant.
 *
 * Metaphor: a guided mission briefing. The page reads top-to-bottom:
 *   Hero ("here's what you're about to ignite") →
 *   4 Chapters ("Stage / Adopt / Wire / Sow"), each with one CTA →
 *   Live banner ("Lifecycle is live") that surfaces only when ready.
 *
 * Why this differs from baseline: instead of three parallel cards
 * (gates / adoption / flow / triggers) competing for attention, the user
 * always has exactly one "next action" — the chapter highlighted with the
 * primary button. Future chapters dim, completed chapters compress.
 */
import { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Sparkles, FolderKanban, Bot, Zap, Target, Rocket,
  CheckCircle2, ChevronRight, GitBranch, ArrowRight,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useSystemStore } from '@/stores/systemStore';
import { useDevCloneAdoption } from '../../useDevCloneAdoption';
import { useToastStore } from '@/stores/toastStore';
import { createTrigger } from '@/api/pipeline/triggers';
import type { Persona } from '@/lib/bindings/Persona';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';

interface Props {
  devClone: Persona | null;
  triggers: PersonaTrigger[];
  activeProject: { name: string; root_path: string; github_url?: string | null } | null;
  goalCount: number;
  hasApprovedListener: boolean;
  hasRejectedListener: boolean;
  hasScheduleTrigger: boolean;
  loading: boolean;
  onRefresh: () => void;
}

type ChapterStatus = 'done' | 'current' | 'pending' | 'blocked';

interface Chapter {
  id: string;
  index: number;
  title: string;
  outcome: string;        // What the user gains by completing this
  status: ChapterStatus;
  detail: React.ReactNode;
  cta?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean };
}

const REVIEW_APPROVED_EVENT = 'review_decision.approved';
const REVIEW_REJECTED_EVENT = 'review_decision.rejected';

export function SetupMissionControl({
  devClone, triggers: _triggers, activeProject, goalCount,
  hasApprovedListener, hasRejectedListener, hasScheduleTrigger,
  onRefresh,
}: Props) {
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const addToast = useToastStore((s) => s.addToast);
  const { adoptDevClone, adopting } = useDevCloneAdoption();

  const hasProject = Boolean(activeProject);
  const hasGithub = Boolean(activeProject?.github_url);
  const hasPersona = Boolean(devClone);
  const triggersConfigured = hasApprovedListener && hasRejectedListener && hasScheduleTrigger;
  const hasGoals = goalCount > 0;

  const handleAdopt = useCallback(async () => {
    const p = await adoptDevClone();
    if (p) onRefresh();
  }, [adoptDevClone, onRefresh]);

  const handleWireTriggers = useCallback(async () => {
    if (!devClone) return;
    try {
      let n = 0;
      if (!hasApprovedListener) {
        await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_APPROVED_EVENT }), enabled: true, use_case_id: null });
        n++;
      }
      if (!hasRejectedListener) {
        await createTrigger({ persona_id: devClone.id, trigger_type: 'event_listener', config: JSON.stringify({ listen_event_type: REVIEW_REJECTED_EVENT }), enabled: true, use_case_id: null });
        n++;
      }
      if (!hasScheduleTrigger) {
        await createTrigger({ persona_id: devClone.id, trigger_type: 'schedule', config: JSON.stringify({ cron: '0 * * * *', event_type: 'dev_clone.hourly_scan', payload: JSON.stringify({ mode: 'backlog_scan' }) }), enabled: true, use_case_id: null });
        n++;
      }
      addToast(`Wired ${n} trigger${n === 1 ? '' : 's'}.`, 'success');
      onRefresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Failed to wire triggers', 'error');
    }
  }, [devClone, hasApprovedListener, hasRejectedListener, hasScheduleTrigger, addToast, onRefresh]);

  const chapters: Chapter[] = useMemo(() => {
    const list: Chapter[] = [
      {
        id: 'stage',
        index: 1,
        title: 'Set the stage',
        outcome: 'Dev Clone needs a project to live in — a name, a path, optionally a GitHub repo for PR work.',
        status: hasProject ? 'done' : 'current',
        detail: hasProject ? (
          <ProjectSummary
            name={activeProject!.name}
            path={activeProject!.root_path}
            githubUrl={activeProject?.github_url ?? null}
          />
        ) : (
          <p className="text-base text-foreground/70">No project selected. Open the Projects tab and create or pick one.</p>
        ),
        cta: hasProject
          ? undefined
          : { label: 'Open Projects', onClick: () => setDevToolsTab('projects') },
      },
      {
        id: 'adopt',
        index: 2,
        title: 'Adopt your Dev Clone',
        outcome: 'A persona that knows your stack, scans for opportunities, and proposes work for you to review.',
        status: !hasProject ? 'pending' : hasPersona ? 'done' : 'current',
        detail: hasPersona ? (
          <PersonaSummary name={devClone!.name} githubReady={hasGithub} />
        ) : (
          <PersonaPreview hasGithub={hasGithub} />
        ),
        cta: hasPersona
          ? undefined
          : {
              label: 'Adopt Dev Clone',
              onClick: handleAdopt,
              loading: adopting,
              disabled: !hasProject,
            },
      },
      {
        id: 'wire',
        index: 3,
        title: 'Wire the autonomous loop',
        outcome: 'Three triggers turn it on: an hourly scan, plus listeners for your approve/reject decisions.',
        status: !hasPersona ? 'pending' : triggersConfigured ? 'done' : 'current',
        detail: (
          <TriggerChecklist
            schedule={hasScheduleTrigger}
            approved={hasApprovedListener}
            rejected={hasRejectedListener}
          />
        ),
        cta: !hasPersona || triggersConfigured
          ? undefined
          : {
              label: 'Wire all triggers',
              onClick: handleWireTriggers,
            },
      },
      {
        id: 'sow',
        index: 4,
        title: 'Plant goals to guide it',
        outcome: 'Goals tell Dev Clone what to chase first. Without them, it scans broadly with no priorities.',
        status: !triggersConfigured ? 'pending' : hasGoals ? 'done' : 'current',
        detail: hasGoals ? (
          <p className="text-base text-foreground/80">
            <span className="font-semibold text-foreground tabular-nums">{goalCount}</span> goal{goalCount === 1 ? '' : 's'} on this project — Dev Clone will prioritise them on the next scan.
          </p>
        ) : (
          <p className="text-base text-foreground/70">No goals yet. Add at least one in the Projects tab so the agent has direction.</p>
        ),
        cta: !triggersConfigured || hasGoals
          ? undefined
          : { label: 'Add goals', onClick: () => setDevToolsTab('projects') },
      },
    ];
    return list;
  }, [
    hasProject, hasPersona, triggersConfigured, hasGoals, hasGithub,
    activeProject, devClone, goalCount, adopting,
    hasApprovedListener, hasRejectedListener, hasScheduleTrigger,
    handleAdopt, handleWireTriggers, setDevToolsTab,
  ]);

  const completedCount = chapters.filter((c) => c.status === 'done').length;
  const totalCount = chapters.length;
  const allReady = completedCount === totalCount;

  return (
    <div className="relative pb-8">
      {/* Decorative background — subtle orbital arc that fills with progress */}
      <BackgroundArc progress={completedCount / totalCount} />

      {/* Hero */}
      <div className="relative mb-8">
        <div className="flex items-start gap-4">
          <div className="relative w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
            <Rocket className="w-6 h-6 text-violet-400" />
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-full border border-violet-400/40"
              animate={{ scale: [1, 1.4, 1], opacity: [0.7, 0, 0.7] }}
              transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}
            />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-2xl font-semibold text-foreground leading-tight">
              Bring Dev Clone online
            </h2>
            <p className="text-base text-foreground/70 mt-1 max-w-2xl">
              An autonomous agent that scans your codebase every hour, proposes work, and learns from how you triage its suggestions. You'll wire it up in four short chapters.
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Progress</p>
            <p className="text-2xl font-semibold text-violet-400 tabular-nums leading-tight mt-0.5">
              {completedCount}<span className="text-foreground/40 text-base">/{totalCount}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Chapter tape */}
      <div className="relative space-y-3">
        {chapters.map((c) => (
          <ChapterCard key={c.id} chapter={c} />
        ))}
      </div>

      {/* Live banner */}
      {allReady && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="mt-6 rounded-card border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-emerald-500/5 to-transparent p-5"
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground">Lifecycle is live</h3>
              <p className="text-base text-foreground/80 mt-1">
                Dev Clone will scan <span className="font-semibold">{activeProject?.name}</span> every hour, post proposals to the review queue, and act on your approval / rejection events. Memory updates after each cycle.
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chapter card
// ---------------------------------------------------------------------------

function ChapterCard({ chapter }: { chapter: Chapter }) {
  const isCurrent = chapter.status === 'current';
  const isDone = chapter.status === 'done';
  const isPending = chapter.status === 'pending';

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={[
        'relative rounded-card border transition-colors',
        isCurrent && 'border-violet-500/40 bg-gradient-to-br from-violet-500/8 via-violet-500/3 to-transparent shadow-elevation-2',
        isDone && 'border-emerald-500/25 bg-emerald-500/5',
        isPending && 'border-primary/10 bg-card/30 opacity-70',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex gap-4 p-5">
        {/* Numbered medallion */}
        <div className="shrink-0">
          <div className={[
            'relative w-10 h-10 rounded-full flex items-center justify-center border',
            isDone && 'bg-emerald-500/15 border-emerald-500/30',
            isCurrent && 'bg-violet-500/15 border-violet-500/40',
            isPending && 'bg-foreground/5 border-foreground/15',
          ].filter(Boolean).join(' ')}>
            {isDone ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            ) : (
              <span className={[
                'text-base font-semibold tabular-nums',
                isCurrent && 'text-violet-300',
                isPending && 'text-foreground/40',
              ].filter(Boolean).join(' ')}>
                {chapter.index}
              </span>
            )}
            {isCurrent && (
              <motion.span
                aria-hidden
                className="absolute inset-0 rounded-full border border-violet-400/40"
                animate={{ scale: [1, 1.35, 1], opacity: [0.7, 0, 0.7] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
              />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3">
            <h3 className={[
              'text-lg font-semibold',
              isPending ? 'text-foreground/60' : 'text-foreground',
            ].join(' ')}>
              {chapter.title}
            </h3>
            {isCurrent && (
              <span className="text-xs uppercase tracking-[0.2em] text-violet-300">Up next</span>
            )}
          </div>
          <p className={[
            'text-base mt-1',
            isPending ? 'text-foreground/50' : 'text-foreground/80',
          ].join(' ')}>
            {chapter.outcome}
          </p>
          <div className="mt-3">
            {chapter.detail}
          </div>
        </div>

        {/* CTA */}
        {chapter.cta && (
          <div className="shrink-0 self-center">
            <Button
              variant={isCurrent ? 'accent' : 'secondary'}
              accentColor="violet"
              size="md"
              icon={<ArrowRight className="w-4 h-4" />}
              loading={chapter.cta.loading}
              disabled={chapter.cta.disabled}
              onClick={chapter.cta.onClick}
            >
              {chapter.cta.label}
            </Button>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Detail components — surface the real data the user is choosing about
// ---------------------------------------------------------------------------

function ProjectSummary({ name, path, githubUrl }: { name: string; path: string; githubUrl: string | null }) {
  return (
    <div className="flex items-center gap-3 rounded-interactive border border-primary/10 bg-card/40 px-3 py-2">
      <FolderKanban className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="text-base font-medium text-foreground">{name}</span>
      <span className="text-sm text-foreground/60 truncate flex-1 min-w-0">{path}</span>
      {githubUrl ? (
        <span className="flex items-center gap-1 text-sm text-emerald-400 shrink-0">
          <GitBranch className="w-3.5 h-3.5" /> repo linked
        </span>
      ) : (
        <span className="text-sm text-foreground/50 shrink-0">no repo</span>
      )}
    </div>
  );
}

function PersonaSummary({ name, githubReady }: { name: string; githubReady: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-interactive border border-primary/10 bg-card/40 px-3 py-2">
      <Bot className="w-4 h-4 text-violet-400 shrink-0" />
      <span className="text-base font-medium text-foreground">{name}</span>
      <span className="text-sm text-foreground/60">adopted</span>
      {!githubReady && (
        <span className="ml-auto text-sm text-amber-400 shrink-0">limited — no GitHub</span>
      )}
    </div>
  );
}

function PersonaPreview({ hasGithub }: { hasGithub: boolean }) {
  return (
    <div className="rounded-interactive border border-dashed border-violet-500/25 bg-violet-500/5 px-3 py-2.5">
      <p className="text-sm text-foreground/80">
        Bundled template adopts in one click — installs the persona, registers tools, and stages the trigger configuration.
      </p>
      {!hasGithub && (
        <p className="text-sm text-amber-400 mt-1">
          Without GitHub, Dev Clone proposes but cannot open PRs.
        </p>
      )}
    </div>
  );
}

function TriggerChecklist({ schedule, approved, rejected }: { schedule: boolean; approved: boolean; rejected: boolean }) {
  const items = [
    { ok: schedule, icon: Zap, label: 'Hourly scan', detail: 'cron: 0 * * * *' },
    { ok: approved, icon: CheckCircle2, label: 'Approval listener', detail: 'review_decision.approved' },
    { ok: rejected, icon: ChevronRight, label: 'Rejection listener', detail: 'review_decision.rejected' },
  ];
  return (
    <ul className="space-y-1.5">
      {items.map((it) => {
        const Icon = it.icon;
        return (
          <li key={it.label} className="flex items-center gap-2 text-sm">
            {it.ok ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            ) : (
              <Icon className="w-4 h-4 text-foreground/40 shrink-0" />
            )}
            <span className={it.ok ? 'text-foreground' : 'text-foreground/70'}>{it.label}</span>
            <span className="font-mono text-xs text-foreground/50">{it.detail}</span>
            {it.ok && <span className="ml-auto text-xs uppercase tracking-[0.18em] text-emerald-400">active</span>}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Background — orbital arc that fills with progress
// ---------------------------------------------------------------------------

function BackgroundArc({ progress }: { progress: number }) {
  const r = 220;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - progress);
  return (
    <svg
      viewBox="-300 -300 600 600"
      className="absolute -top-10 -right-20 w-[520px] h-[520px] pointer-events-none"
      style={{ opacity: 0.18 }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="mc-arc" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.0} />
          <stop offset="50%" stopColor="#a78bfa" stopOpacity={0.6} />
          <stop offset="100%" stopColor="#a78bfa" stopOpacity={0.0} />
        </linearGradient>
      </defs>
      <circle cx={0} cy={0} r={r} fill="none" stroke="currentColor" className="text-foreground/20" strokeWidth={1} />
      <motion.circle
        cx={0} cy={0} r={r}
        fill="none"
        stroke="url(#mc-arc)"
        strokeWidth={2}
        strokeDasharray={c}
        animate={{ strokeDashoffset: dashOffset }}
        initial={false}
        transition={{ duration: 1.0, ease: 'easeOut' }}
        transform="rotate(-90)"
      />
      <Target className="text-foreground/30" />
    </svg>
  );
}
