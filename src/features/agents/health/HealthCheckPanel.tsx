import { useCallback } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Wrench,
  Activity,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { FEASIBILITY_COLORS, SEVERITY_STYLES } from '@/lib/utils/designTokens';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { DryRunIssue, DryRunResult, HealthScore } from './types';
import type { DesignContextData } from '@/lib/types/frontendTypes';
import type { UseHealthCheckReturn } from './useHealthCheck';

// ── Score display ────────────────────────────────────────────────────

function ScoreBadge({ score }: { score: HealthScore }) {
  const gradeColors = {
    healthy: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
    degraded: 'text-amber-400 bg-amber-500/10 border-amber-500/30',
    unhealthy: 'text-red-400 bg-red-500/10 border-red-500/30',
  };

  const gradeLabels = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    unhealthy: 'Unhealthy',
  };

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-semibold border ${gradeColors[score.grade]}`}>
      <Activity className="w-4 h-4" />
      <span>{score.value}</span>
      <span className="text-xs font-normal opacity-70">{gradeLabels[score.grade]}</span>
    </div>
  );
}

// ── Score ring visualization ─────────────────────────────────────────

function ScoreRing({ score }: { score: HealthScore }) {
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.value / 100) * circumference;

  const strokeColor = {
    healthy: '#10B981',
    degraded: '#F59E0B',
    unhealthy: '#EF4444',
  }[score.grade];

  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="currentColor" strokeWidth="4" className="text-primary/10" />
        <motion.circle
          cx="40" cy="40" r={radius} fill="none" stroke={strokeColor} strokeWidth="4"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xl font-bold text-foreground/90">{score.value}</span>
      </div>
    </div>
  );
}

// ── Issue card ───────────────────────────────────────────────────────

const SEVERITY_ICONS: Record<DryRunIssue['severity'], typeof AlertTriangle> = {
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

interface HealthIssueCardProps {
  issue: DryRunIssue;
  personaId: string;
  onApplyFix: (issue: DryRunIssue) => void;
  onResolved: (id: string) => void;
}

function HealthIssueCard({ issue, onApplyFix, onResolved }: HealthIssueCardProps) {
  const style = SEVERITY_STYLES[issue.severity];
  const Icon = SEVERITY_ICONS[issue.severity];

  const handleApply = () => {
    onApplyFix(issue);
    onResolved(issue.id);
  };

  if (issue.resolved) {
    return (
      <motion.div
        initial={{ opacity: 0.5 }}
        animate={{ opacity: 1 }}
        className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl ${SEVERITY_STYLES.success.border} ${SEVERITY_STYLES.success.bg}`}
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 mt-0.5 shrink-0" />
        <span className="text-sm text-muted-foreground/50 line-through leading-relaxed">
          {issue.description}
        </span>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={`px-3 py-2.5 rounded-xl ${style.border} ${style.bg}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`w-3.5 h-3.5 ${style.text} mt-0.5 shrink-0`} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground/80 leading-relaxed">
            {issue.description}
          </p>
          {issue.proposal ? (
            <button
              type="button"
              onClick={handleApply}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 text-sm font-medium rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
            >
              <Wrench className="w-3 h-3" />
              Apply Fix: {issue.proposal.label}
            </button>
          ) : (
            <p className="mt-1.5 text-sm text-muted-foreground/50 italic">
              Manual action needed
            </p>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ── Main panel ───────────────────────────────────────────────────────

interface HealthCheckPanelProps {
  healthCheck: UseHealthCheckReturn;
}

export function HealthCheckPanel({ healthCheck }: HealthCheckPanelProps) {
  const { phase, result, score, error, runHealthCheck, markIssueResolved, reset } = healthCheck;
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);
  const applyPersonaOp = usePersonaStore((s) => s.applyPersonaOp);
  const addToast = useToastStore((s) => s.addToast);

  const handleRun = useCallback(async () => {
    if (!selectedPersona) return;
    await runHealthCheck(selectedPersona);
  }, [selectedPersona, runHealthCheck]);

  const handleApplyFix = useCallback(async (issue: DryRunIssue) => {
    if (!selectedPersona || !issue.proposal) return;

    try {
      // Apply proposal actions to the persona's design context
      const ctx = parseJsonOrDefault<DesignContextData | null>(selectedPersona.design_context, null) ?? {};
      let updated = { ...ctx };

      for (const action of issue.proposal.actions) {
        switch (action.type) {
          case 'UPDATE_COMPONENT_CREDENTIAL': {
            const { componentId, credentialId } = action.payload as { componentId: string; credentialId: string };
            updated = {
              ...updated,
              credentialLinks: { ...updated.credentialLinks, [componentId]: credentialId },
            };
            break;
          }
          case 'AUTO_MATCH_CREDENTIALS': {
            const { credentials } = action.payload as { credentials: Array<{ id: string; service_type: string }> };
            const links = { ...updated.credentialLinks };
            for (const cred of credentials) {
              // Link any unlinked connector matching this service type
              if (!links[cred.service_type]) {
                links[cred.service_type] = cred.id;
              }
            }
            updated = { ...updated, credentialLinks: links };
            break;
          }
          case 'ADD_USE_CASE_WITH_DATA': {
            const { title, description, category } = action.payload as { title: string; description: string; category: string };
            const useCases = updated.useCases ?? [];
            updated = {
              ...updated,
              useCases: [...useCases, {
                id: `hc_uc_${Date.now()}`,
                title,
                description,
                category,
              }],
            };
            break;
          }
          default:
            // For other action types, store them as metadata hints
            break;
        }
      }

      await applyPersonaOp(selectedPersona.id, {
        kind: 'UpdateDesignContext',
        design_context: JSON.stringify(updated),
      });

      addToast(`Applied fix: ${issue.proposal.label}`, 'success');
    } catch (err) {
      addToast(`Failed to apply fix: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [selectedPersona, applyPersonaOp, addToast]);

  // Idle state — prompt to run
  if (phase === 'idle') {
    return (
      <div className="space-y-4">
        <div className="text-center py-8">
          <Activity className="w-10 h-10 text-primary/40 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-foreground/80 mb-1">Agent Health Check</h3>
          <p className="text-sm text-muted-foreground/60 mb-4 max-w-sm mx-auto">
            Run a dry-run analysis against this agent's current configuration to detect missing credentials,
            disconnected connectors, and underspecified use cases.
          </p>
          <button
            type="button"
            onClick={handleRun}
            disabled={!selectedPersona}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40"
          >
            <Activity className="w-4 h-4" />
            Run Health Check
          </button>
        </div>
      </div>
    );
  }

  // Running state
  if (phase === 'running') {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
          <p className="text-sm text-muted-foreground/60">Analyzing agent configuration...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (phase === 'error') {
    return (
      <div className="space-y-4">
        <div className="px-4 py-3 rounded-xl bg-red-500/5 border border-red-500/20">
          <div className="flex items-start gap-2">
            <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-red-400">Health check failed</p>
              <p className="text-sm text-muted-foreground/60 mt-0.5">{error}</p>
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { reset(); handleRun(); }}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Retry
        </button>
      </div>
    );
  }

  // Done state — show results
  if (!result || !score) return null;

  const dryRun: DryRunResult = result.result;
  const statusTokens = (FEASIBILITY_COLORS[dryRun.status] ?? FEASIBILITY_COLORS['partial'])!;
  const remainingIssues = dryRun.issues.filter((i: DryRunIssue) => !i.resolved).length;

  return (
    <div className="space-y-4">
      {/* Header: Score + status + re-run */}
      <div className="flex items-center gap-4">
        <ScoreRing score={score} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <ScoreBadge score={score} />
            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-xs font-medium ${statusTokens.bgColor} ${statusTokens.color} border ${statusTokens.borderColor}`}>
              {dryRun.status === 'ready' ? <CheckCircle2 className="w-3 h-3" /> : dryRun.status === 'blocked' ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {dryRun.status.charAt(0).toUpperCase() + dryRun.status.slice(1)}
            </div>
          </div>
          <p className="text-sm text-muted-foreground/60">
            {remainingIssues > 0
              ? `${remainingIssues} issue${remainingIssues !== 1 ? 's' : ''} found`
              : 'No issues detected'}
            {' \u00b7 '}
            Checked {new Date(result.checkedAt).toLocaleTimeString()}
          </p>
        </div>
        <button
          type="button"
          onClick={handleRun}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-secondary/60 text-muted-foreground border border-primary/15 hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Re-run
        </button>
      </div>

      {/* Capabilities */}
      {dryRun.capabilities.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">
            Capabilities
          </p>
          <div className="space-y-1">
            {dryRun.capabilities.map((cap: string, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm text-emerald-400/80">
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span className="text-foreground/70">{cap}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Issues */}
      <AnimatePresence mode="popLayout">
        {dryRun.issues.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium text-muted-foreground/60 uppercase tracking-wider">
              Issues
            </p>
            <div className="space-y-2">
              {dryRun.issues.map((issue: DryRunIssue) => (
                <HealthIssueCard
                  key={issue.id}
                  issue={issue}
                  personaId={result.personaId}
                  onApplyFix={handleApplyFix}
                  onResolved={markIssueResolved}
                />
              ))}
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* All clear */}
      {dryRun.issues.length === 0 && dryRun.capabilities.length > 0 && (
        <p className="text-sm text-emerald-400/70">
          No issues found. Your agent configuration looks good.
        </p>
      )}
    </div>
  );
}
