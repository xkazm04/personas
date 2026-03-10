import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  RefreshCw,
<<<<<<< HEAD
=======
  Loader2,
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  ChevronRight,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { usePersonaStore } from '@/stores/personaStore';
import { SEVERITY_STYLES } from '@/lib/utils/designTokens';
import type { DryRunIssue, PersonaHealthCheck, HealthScore } from './types';
<<<<<<< HEAD
import ContentLoader from '@/features/shared/components/ContentLoader';
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989

// ── Score ring (compact) ─────────────────────────────────────────────

function CompactScoreRing({ score }: { score: HealthScore }) {
  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score.value / 100) * circumference;

  const strokeColor = {
    healthy: '#10B981',
    degraded: '#F59E0B',
    unhealthy: '#EF4444',
  }[score.grade];

  return (
    <div className="relative w-12 h-12 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 40 40">
        <circle cx="20" cy="20" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/10" />
        <motion.circle
          cx="20" cy="20" r={radius} fill="none" stroke={strokeColor} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-foreground/90">{score.value}</span>
      </div>
    </div>
  );
}

// ── Persona row in digest ────────────────────────────────────────────

function PersonaDigestRow({
  check,
  onNavigate,
}: {
  check: PersonaHealthCheck;
  onNavigate: (personaId: string) => void;
}) {
  const errors = check.result.issues.filter((i: DryRunIssue) => i.severity === 'error').length;
  const warnings = check.result.issues.filter((i: DryRunIssue) => i.severity === 'warning').length;
  const infos = check.result.issues.filter((i: DryRunIssue) => i.severity === 'info').length;
  const totalIssues = errors + warnings + infos;

  return (
    <button
      type="button"
      onClick={() => onNavigate(check.personaId)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-primary/5 transition-colors text-left group"
    >
      {/* Persona icon */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{
          backgroundColor: `${check.personaColor || '#6B7280'}20`,
          border: `1px solid ${check.personaColor || '#6B7280'}40`,
          color: check.personaColor || '#6B7280',
        }}
      >
        {check.personaIcon || check.personaName.charAt(0).toUpperCase()}
      </div>

      {/* Name + issue counts */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground/80 truncate">{check.personaName}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {totalIssues === 0 ? (
            <span className="text-xs text-emerald-400/70 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Healthy
            </span>
          ) : (
            <>
              {errors > 0 && (
                <span className="text-xs text-red-400 flex items-center gap-0.5">
                  <XCircle className="w-3 h-3" /> {errors}
                </span>
              )}
              {warnings > 0 && (
                <span className="text-xs text-amber-400 flex items-center gap-0.5">
                  <AlertTriangle className="w-3 h-3" /> {warnings}
                </span>
              )}
              {infos > 0 && (
                <span className="text-xs text-blue-400 flex items-center gap-0.5">
                  <Info className="w-3 h-3" /> {infos}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
        check.result.status === 'ready' ? 'bg-emerald-400' :
        check.result.status === 'blocked' ? 'bg-red-400' : 'bg-amber-400'
      }`} />

      <ChevronRight className="w-4 h-4 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
    </button>
  );
}

// ── Main digest panel ────────────────────────────────────────────────

export function HealthDigestPanel() {
  const digest = usePersonaStore((s) => s.healthDigest);
  const running = usePersonaStore((s) => s.healthDigestRunning);
  const runFullHealthDigest = usePersonaStore((s) => s.runFullHealthDigest);
  const selectPersona = usePersonaStore((s) => s.selectPersona);
  const setEditorTab = usePersonaStore((s) => s.setEditorTab);

  const handleNavigate = (personaId: string) => {
    selectPersona(personaId);
    setEditorTab('settings'); // Navigate to settings tab where health check will be accessible
  };

  const handleRunDigest = async () => {
    await runFullHealthDigest();
  };

  // Loading state
  if (running) {
    return (
      <div className="rounded-xl border border-primary/15 bg-secondary/40 p-6">
<<<<<<< HEAD
        <ContentLoader variant="panel" label="Generating digest..." hint="health-digest" />
=======
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <Loader2 className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
            <p className="text-sm text-muted-foreground/60">Running health digest across all agents...</p>
          </div>
        </div>
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
      </div>
    );
  }

  // No digest yet — prompt to run
  if (!digest) {
    return (
      <div className="rounded-xl border border-primary/15 bg-secondary/40 p-6">
        <div className="flex items-center gap-3 mb-4">
          <Activity className="w-5 h-5 text-primary/60" />
          <h3 className="text-sm font-semibold text-foreground/80">Agent Health Digest</h3>
        </div>
        <p className="text-sm text-muted-foreground/60 mb-4">
          Run a comprehensive health check across all your agents to detect configuration drift, expired credentials, and optimization opportunities.
        </p>
        <button
          type="button"
          onClick={handleRunDigest}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-xl bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
        >
          <Activity className="w-4 h-4" />
          Run Health Digest
        </button>
      </div>
    );
  }

  // Show results
  const { totalScore, totalIssues, errorCount, warningCount, infoCount, personas } = digest;

  // Sort: unhealthy first, then by issue count desc
  const sorted = [...personas].sort((a, b) => {
    const aIssues = a.result.issues.length;
    const bIssues = b.result.issues.length;
    if (a.result.status === 'blocked' && b.result.status !== 'blocked') return -1;
    if (b.result.status === 'blocked' && a.result.status !== 'blocked') return 1;
    return bIssues - aIssues;
  });

  return (
    <div className="rounded-xl border border-primary/15 bg-secondary/40 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-primary/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="w-5 h-5 text-primary/60" />
          <h3 className="text-sm font-semibold text-foreground/80">Agent Health Digest</h3>
        </div>
        <button
          type="button"
          onClick={handleRunDigest}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg bg-secondary/60 text-muted-foreground border border-primary/15 hover:bg-secondary/80 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          Re-run
        </button>
      </div>

      {/* Summary bar */}
      <div className="px-4 py-3 flex items-center gap-4 border-b border-primary/10 bg-primary/[0.02]">
        <CompactScoreRing score={totalScore} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/80">
            {totalScore.grade === 'healthy' ? 'All systems healthy' :
             totalScore.grade === 'degraded' ? 'Some agents need attention' :
             'Critical issues detected'}
          </p>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs text-muted-foreground/60">
              {personas.length} agent{personas.length !== 1 ? 's' : ''} checked
            </span>
            {totalIssues > 0 && (
              <>
                <span className="text-xs text-muted-foreground/30">\u00b7</span>
                <span className="text-xs text-muted-foreground/60">
                  {totalIssues} issue{totalIssues !== 1 ? 's' : ''}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Issue breakdown badges */}
        {totalIssues > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {errorCount > 0 && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${SEVERITY_STYLES.error.bg} ${SEVERITY_STYLES.error.text}`}>
                <XCircle className="w-3 h-3" /> {errorCount}
              </span>
            )}
            {warningCount > 0 && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${SEVERITY_STYLES.warning.bg} ${SEVERITY_STYLES.warning.text}`}>
                <AlertTriangle className="w-3 h-3" /> {warningCount}
              </span>
            )}
            {infoCount > 0 && (
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ${SEVERITY_STYLES.info.bg} ${SEVERITY_STYLES.info.text}`}>
                <Info className="w-3 h-3" /> {infoCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Per-persona list */}
      <div className="divide-y divide-primary/5">
        {sorted.map((check) => (
          <PersonaDigestRow key={check.personaId} check={check} onNavigate={handleNavigate} />
        ))}
      </div>

      {/* Timestamp */}
      <div className="px-4 py-2 border-t border-primary/10 bg-primary/[0.02]">
        <p className="text-xs text-muted-foreground/60">
          Last run: {new Date(digest.generatedAt).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
