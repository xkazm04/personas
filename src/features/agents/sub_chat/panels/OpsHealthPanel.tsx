import { useCallback } from 'react';
import { Activity, AlertTriangle, XCircle, Info, RotateCcw, Loader2 } from 'lucide-react';
import { useAgentStore } from '@/stores/agentStore';
import { useShallow } from 'zustand/react/shallow';
import { computeHealthScore } from '@/features/agents/health/useHealthCheck';
import type { HealthScore } from '@/features/agents/health/types';

function MiniScoreRing({ score }: { score: HealthScore }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const progress = score.value / 100;
  const strokeColor = {
    healthy: '#10B981',
    degraded: '#F59E0B',
    unhealthy: '#EF4444',
  }[score.grade];

  return (
    <div className="relative w-16 h-16 flex-shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/10" />
        <circle
          cx="32" cy="32" r={radius} fill="none" stroke={strokeColor} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-bold text-foreground/90">{score.value}</span>
      </div>
    </div>
  );
}

const GRADE_LABELS: Record<string, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
};

const GRADE_COLORS: Record<string, string> = {
  healthy: 'text-emerald-400',
  degraded: 'text-amber-400',
  unhealthy: 'text-red-400',
};

export default function OpsHealthPanel({ personaId }: { personaId: string }) {
  const { healthDigest, healthDigestRunning, runFullHealthDigest } = useAgentStore(useShallow((s) => ({
    healthDigest: s.healthDigest,
    healthDigestRunning: s.healthDigestRunning,
    runFullHealthDigest: s.runFullHealthDigest,
  })));

  const handleRunCheck = useCallback(async () => {
    await runFullHealthDigest();
  }, [runFullHealthDigest]);

  // Find this persona's health check in the digest
  const personaHealth = healthDigest?.personas.find((p) => p.personaId === personaId);
  const issues = personaHealth?.result.issues ?? [];
  const score = personaHealth ? computeHealthScore(issues) : null;

  const errorCount = issues.filter((i) => !i.resolved && i.severity === 'error').length;
  const warningCount = issues.filter((i) => !i.resolved && i.severity === 'warning').length;
  const infoCount = issues.filter((i) => !i.resolved && i.severity === 'info').length;

  return (
    <div className="p-3 space-y-3" data-testid="ops-health-panel">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="typo-label text-muted-foreground/70">Health</h3>
        <button
          onClick={handleRunCheck}
          disabled={healthDigestRunning}
          className="p-1 rounded-md text-muted-foreground/40 hover:text-muted-foreground/70 hover:bg-primary/5 transition-colors disabled:opacity-40"
          title="Run health check"
          aria-label="Run health check"
        >
          {healthDigestRunning ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <RotateCcw className="w-3 h-3" />
          )}
        </button>
      </div>

      {/* Score display */}
      {score ? (
        <div className="flex items-center gap-3">
          <MiniScoreRing score={score} />
          <div>
            <p className={`text-sm font-semibold ${GRADE_COLORS[score.grade] ?? 'text-foreground/80'}`}>
              {GRADE_LABELS[score.grade] ?? score.grade}
            </p>
            <p className="text-[11px] text-muted-foreground/50">
              {personaHealth?.checkedAt
                ? `Checked ${new Date(personaHealth.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Last check'}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4">
          <Activity className="w-6 h-6 text-muted-foreground/20" />
          <p className="text-xs text-muted-foreground/40 text-center">No health data</p>
        </div>
      )}

      {/* Run check button */}
      <button
        onClick={handleRunCheck}
        disabled={healthDigestRunning}
        data-testid="ops-health-run-btn"
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 hover:border-amber-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {healthDigestRunning ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Checking...
          </>
        ) : (
          <>
            <Activity className="w-3.5 h-3.5" />
            Run Health Check
          </>
        )}
      </button>

      {/* Issue summary */}
      {(errorCount > 0 || warningCount > 0 || infoCount > 0) && (
        <div className="space-y-1">
          <h4 className="text-[11px] text-muted-foreground/50 font-medium uppercase tracking-wider">Issues</h4>
          <div className="flex items-center gap-3 px-2.5 py-2 rounded-lg bg-secondary/20">
            {errorCount > 0 && (
              <div className="flex items-center gap-1">
                <XCircle className="w-3 h-3 text-red-400" />
                <span className="text-xs text-red-400 font-medium">{errorCount}</span>
              </div>
            )}
            {warningCount > 0 && (
              <div className="flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 text-amber-400" />
                <span className="text-xs text-amber-400 font-medium">{warningCount}</span>
              </div>
            )}
            {infoCount > 0 && (
              <div className="flex items-center gap-1">
                <Info className="w-3 h-3 text-blue-400" />
                <span className="text-xs text-blue-400 font-medium">{infoCount}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
