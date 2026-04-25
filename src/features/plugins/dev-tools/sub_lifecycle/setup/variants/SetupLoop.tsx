/**
 * The Loop — system-diagram variant.
 *
 * Metaphor: a running engine, drawn as a circular flowchart. The user sees
 * the autonomous cycle they are enabling — Scan → Propose → Review → Build
 * → Memory → back to Scan — with each node showing its real status. The
 * right rail surfaces the missing pieces as concrete blockers with inline
 * actions, so "what to do next" is always answered without the user
 * scrolling.
 *
 * Why this differs from baseline: instead of a checklist of gates, this
 * variant teaches the system. The user understands the loop they are
 * approving, not just a set of preconditions.
 */
import { useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Search, ClipboardCheck, Eye, Hammer, Brain, Bot,
  CheckCircle2, AlertCircle, Zap, Sparkles, ArrowUpRight,
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

const REVIEW_APPROVED_EVENT = 'review_decision.approved';
const REVIEW_REJECTED_EVENT = 'review_decision.rejected';

interface LoopNode {
  id: string;
  angle: number;       // 0 = right, π/2 = down (SVG y-axis)
  icon: typeof Search;
  label: string;
  caption: string;
  active: boolean;
  fault?: string | null;  // If set, node renders as a blocker
}

export function SetupLoop({
  devClone, triggers, activeProject, goalCount,
  hasApprovedListener, hasRejectedListener, hasScheduleTrigger,
  onRefresh,
}: Props) {
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);
  const addToast = useToastStore((s) => s.addToast);
  const { adoptDevClone, adopting } = useDevCloneAdoption();

  const hasProject = Boolean(activeProject);
  const hasPersona = Boolean(devClone);
  const triggersConfigured = hasApprovedListener && hasRejectedListener && hasScheduleTrigger;
  const hasGoals = goalCount > 0;
  const allReady = hasProject && hasPersona && triggersConfigured && hasGoals;

  const handleAdopt = useCallback(async () => {
    const p = await adoptDevClone();
    if (p) onRefresh();
  }, [adoptDevClone, onRefresh]);

  const handleWireTriggers = useCallback(async () => {
    if (!devClone) { addToast('Adopt Dev Clone first.', 'error'); return; }
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

  const nodes: LoopNode[] = useMemo(() => [
    {
      id: 'scan',
      angle: -Math.PI / 2,   // top
      icon: Search,
      label: 'Scan codebase',
      caption: 'Hourly cron walks the project',
      active: hasScheduleTrigger,
      fault: !hasScheduleTrigger ? 'No schedule trigger' : null,
    },
    {
      id: 'propose',
      angle: -Math.PI / 2 + (2 * Math.PI / 5),
      icon: ClipboardCheck,
      label: 'Propose tasks',
      caption: hasGoals ? `${goalCount} goal${goalCount === 1 ? '' : 's'} steer the picks` : 'No goals to steer it',
      active: hasPersona && hasGoals,
      fault: !hasGoals ? 'No goals planted' : null,
    },
    {
      id: 'review',
      angle: -Math.PI / 2 + (4 * Math.PI / 5),
      icon: Eye,
      label: 'Human review',
      caption: 'You approve or reject in the queue',
      active: true,
      fault: null,
    },
    {
      id: 'build',
      angle: -Math.PI / 2 + (6 * Math.PI / 5),
      icon: Hammer,
      label: 'Build on approval',
      caption: 'Approved tasks fire a build cycle',
      active: hasApprovedListener,
      fault: !hasApprovedListener ? 'Approval listener not wired' : null,
    },
    {
      id: 'memory',
      angle: -Math.PI / 2 + (8 * Math.PI / 5),
      icon: Brain,
      label: 'Memory learns',
      caption: 'Rejections feed back as learned context',
      active: hasRejectedListener,
      fault: !hasRejectedListener ? 'Rejection listener not wired' : null,
    },
  ], [hasScheduleTrigger, hasPersona, hasGoals, hasApprovedListener, hasRejectedListener, goalCount]);

  // Build the ordered blocker list — this is the right rail
  const blockers = useMemo(() => {
    const list: { id: string; label: string; detail: string; cta: { label: string; onClick: () => void; loading?: boolean } }[] = [];
    if (!hasProject) {
      list.push({
        id: 'project',
        label: 'Pick a project',
        detail: 'Dev Clone needs a project to live in.',
        cta: { label: 'Open Projects', onClick: () => setDevToolsTab('projects') },
      });
    }
    if (hasProject && !hasPersona) {
      list.push({
        id: 'persona',
        label: 'Adopt Dev Clone',
        detail: 'Bundled template — installs in one click.',
        cta: { label: 'Adopt now', onClick: handleAdopt, loading: adopting },
      });
    }
    if (hasPersona && !triggersConfigured) {
      const missing: string[] = [];
      if (!hasScheduleTrigger) missing.push('schedule');
      if (!hasApprovedListener) missing.push('approval listener');
      if (!hasRejectedListener) missing.push('rejection listener');
      list.push({
        id: 'triggers',
        label: 'Wire the triggers',
        detail: `Missing: ${missing.join(', ')}.`,
        cta: { label: 'Wire all', onClick: handleWireTriggers },
      });
    }
    if (triggersConfigured && !hasGoals) {
      list.push({
        id: 'goals',
        label: 'Plant goals',
        detail: 'Without goals, scans return generic suggestions.',
        cta: { label: 'Add goals', onClick: () => setDevToolsTab('projects') },
      });
    }
    return list;
  }, [hasProject, hasPersona, triggersConfigured, hasGoals, hasScheduleTrigger, hasApprovedListener, hasRejectedListener, adopting, handleAdopt, handleWireTriggers, setDevToolsTab]);

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="mb-6 flex items-start gap-4">
        <div className="relative w-12 h-12 rounded-full bg-violet-500/15 border border-violet-500/30 flex items-center justify-center shrink-0">
          <Bot className="w-6 h-6 text-violet-400" />
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full border border-violet-400/40"
            animate={{ scale: [1, 1.4, 1], opacity: [0.7, 0, 0.7] }}
            transition={{ duration: 2.6, repeat: Infinity, ease: 'easeOut' }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-2xl font-semibold text-foreground leading-tight">Dev Clone — the loop you're enabling</h2>
          <p className="text-base text-foreground/70 mt-1 max-w-2xl">
            An autonomous cycle that scans, proposes, waits on you to triage, builds on approval, and learns from your rejections. Below: the engine diagram, plus a punch-list of what's left to wire.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-xs uppercase tracking-[0.2em] text-foreground/60">Health</p>
          <p className={[
            'text-2xl font-semibold tabular-nums leading-tight mt-0.5',
            allReady ? 'text-emerald-400' : blockers.length > 1 ? 'text-amber-400' : 'text-violet-300',
          ].join(' ')}>
            {allReady ? 'Live' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}
          </p>
        </div>
      </div>

      {/* Diagram + rail */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
        {/* Loop SVG */}
        <div className="relative rounded-card border border-primary/15 bg-gradient-to-br from-violet-500/5 via-card/30 to-transparent overflow-hidden">
          <LoopDiagram nodes={nodes} allReady={allReady} />
          {/* Caption */}
          <div className="px-5 pb-4 -mt-2">
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
              {nodes.map((n) => (
                <li key={n.id} className="flex items-center gap-2 min-w-0">
                  <span className={[
                    'w-2 h-2 rounded-full shrink-0',
                    n.active ? 'bg-emerald-400' : 'bg-foreground/25',
                  ].join(' ')} />
                  <span className="font-medium text-foreground">{n.label}</span>
                  <span className="text-foreground/60 truncate">— {n.caption}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right rail — blockers + triggers list */}
        <div className="space-y-4">
          {/* Punch list */}
          <div className="rounded-card border border-primary/15 bg-card/30 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-violet-400" />
              <h3 className="text-base font-semibold text-foreground">What's blocking ignition</h3>
            </div>
            {blockers.length === 0 ? (
              <div className="flex items-center gap-2 text-base text-emerald-400">
                <Sparkles className="w-4 h-4" />
                Nothing — the loop is fully wired.
              </div>
            ) : (
              <ol className="space-y-3">
                {blockers.map((b, i) => (
                  <li key={b.id} className="flex gap-3">
                    <span className="text-base font-semibold text-violet-300 tabular-nums w-5 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-base font-medium text-foreground">{b.label}</p>
                      <p className="text-sm text-foreground/70 mt-0.5">{b.detail}</p>
                      <Button
                        variant={i === 0 ? 'accent' : 'secondary'}
                        accentColor="violet"
                        size="sm"
                        className="mt-2"
                        icon={<ArrowUpRight className="w-3.5 h-3.5" />}
                        loading={b.cta.loading}
                        onClick={b.cta.onClick}
                      >
                        {b.cta.label}
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* Trigger details */}
          {triggers.length > 0 && (
            <div className="rounded-card border border-primary/10 bg-card/20 p-4">
              <h3 className="text-xs uppercase tracking-[0.2em] text-foreground/60 mb-2">
                Active triggers · {triggers.length}
              </h3>
              <ul className="space-y-1.5">
                {triggers.map((tr) => {
                  let label = tr.trigger_type;
                  try {
                    const cfg = JSON.parse(tr.config ?? '{}');
                    if (cfg.listen_event_type) label = cfg.listen_event_type;
                    else if (cfg.cron) label = `cron · ${cfg.cron}`;
                  } catch { /* keep */ }
                  return (
                    <li key={tr.id} className="flex items-center gap-2 text-sm">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${tr.enabled ? 'bg-emerald-400' : 'bg-red-400'}`} />
                      <span className="text-foreground/80 shrink-0">{tr.trigger_type}</span>
                      <span className="font-mono text-xs text-foreground/60 truncate">{label}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoopDiagram — SVG cycle of 5 nodes around a central core
// ---------------------------------------------------------------------------

function LoopDiagram({ nodes, allReady }: { nodes: LoopNode[]; allReady: boolean }) {
  const RADIUS = 130;
  const NODE_R = 32;
  const VIEW = 380;

  const positions = nodes.map((n) => ({
    ...n,
    x: Math.cos(n.angle) * RADIUS,
    y: Math.sin(n.angle) * RADIUS,
  }));

  return (
    <div className="relative" style={{ height: VIEW }}>
      <svg
        viewBox={`-${VIEW / 2} -${VIEW / 2} ${VIEW} ${VIEW}`}
        className="w-full h-full"
        aria-hidden="true"
      >
        <defs>
          <radialGradient id="loop-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#a78bfa" stopOpacity={allReady ? 0.55 : 0.35} />
            <stop offset="60%" stopColor="#a78bfa" stopOpacity={0.1} />
            <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
          </radialGradient>
          <marker id="loop-arrow" markerWidth="10" markerHeight="8" refX="8" refY="4" orient="auto">
            <path d="M0,0 L10,4 L0,8 Z" fill="currentColor" className="text-foreground/40" />
          </marker>
        </defs>

        {/* Core glow */}
        <circle cx={0} cy={0} r={RADIUS - 30} fill="url(#loop-core)" />

        {/* Orbit ring */}
        <circle cx={0} cy={0} r={RADIUS} fill="none" stroke="currentColor" strokeWidth={1} className="text-foreground/15" strokeDasharray="3 4" />

        {/* Connecting arcs between consecutive nodes */}
        {positions.map((p, i) => {
          const next = positions[(i + 1) % positions.length]!;
          const bothActive = p.active && next.active;
          // Compute arc on the orbit between p and next
          // Use SVG path A command
          const x1 = p.x;
          const y1 = p.y;
          const x2 = next.x;
          const y2 = next.y;
          // For a proper arc along the orbit, sweep flag = 1 (clockwise as drawn here)
          return (
            <path
              key={`arc-${i}`}
              d={`M ${x1} ${y1} A ${RADIUS} ${RADIUS} 0 0 1 ${x2} ${y2}`}
              fill="none"
              stroke={bothActive ? '#34d399' : 'currentColor'}
              strokeWidth={bothActive ? 1.8 : 1}
              className={bothActive ? '' : 'text-foreground/15'}
              markerEnd="url(#loop-arrow)"
            />
          );
        })}

        {/* Central persona core */}
        <g>
          <circle cx={0} cy={0} r={42} fill="currentColor" className="text-violet-500/15" stroke="currentColor" strokeWidth={1.5} />
          <foreignObject x={-22} y={-22} width={44} height={44} className="pointer-events-none">
            <div className="w-full h-full flex items-center justify-center text-violet-300">
              <Bot className="w-7 h-7" />
            </div>
          </foreignObject>
        </g>

        {/* Nodes */}
        {positions.map((n) => {
          const Icon = n.icon;
          const isFault = !!n.fault;
          return (
            <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
              {/* Pulse for active node */}
              {n.active && !isFault && (
                <motion.circle
                  cx={0} cy={0} r={NODE_R + 6}
                  fill="none"
                  stroke="#34d399"
                  strokeWidth={1}
                  initial={{ opacity: 0.5, scale: 0.95 }}
                  animate={{ opacity: [0.5, 0, 0.5], scale: [0.95, 1.15, 0.95] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
                />
              )}
              <circle
                cx={0} cy={0} r={NODE_R}
                fill="currentColor"
                className={isFault ? 'text-red-500/15' : n.active ? 'text-emerald-500/15' : 'text-foreground/10'}
                stroke="currentColor"
                strokeWidth={1.5}
              />
              <foreignObject x={-16} y={-16} width={32} height={32} className="pointer-events-none">
                <div className={[
                  'w-full h-full flex items-center justify-center',
                  isFault ? 'text-red-400' : n.active ? 'text-emerald-400' : 'text-foreground/50',
                ].join(' ')}>
                  <Icon className="w-5 h-5" />
                </div>
              </foreignObject>
              {/* Status badge */}
              {(isFault || n.active) && (
                <g transform={`translate(${NODE_R - 6}, ${-NODE_R + 6})`}>
                  <circle cx={0} cy={0} r={7} fill="currentColor" className={isFault ? 'text-red-500' : 'text-emerald-500'} />
                  <foreignObject x={-5} y={-5} width={10} height={10} className="pointer-events-none">
                    <div className="w-full h-full flex items-center justify-center text-white">
                      {isFault ? <AlertCircle className="w-2.5 h-2.5" /> : <CheckCircle2 className="w-2.5 h-2.5" />}
                    </div>
                  </foreignObject>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
