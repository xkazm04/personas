import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  Minus,
  RotateCcw,
  Loader2,
  AlertTriangle,
  ArrowRight,
  Shield,
  Lock,
} from 'lucide-react';
import { usePromptPerformanceSummary, type TrendDirection } from './usePromptPerformanceSummary';
import { rollbackPromptVersion } from '@/api/observability';
import { getAppSetting, setAppSetting } from '@/api/settings';
import { usePersonaStore } from '@/stores/personaStore';
import { useToastStore } from '@/stores/toastStore';
import { fmtPct } from './performanceHelpers';

const AUTO_ROLLBACK_KEY_PREFIX = 'auto_rollback:';

interface PromptPerformanceCardProps {
  personaId: string;
  onOpenLab?: () => void;
}

const TREND_CONFIG: Record<TrendDirection, { icon: typeof TrendingUp; label: string; color: string }> = {
  improving: { icon: TrendingDown, label: 'Improving', color: 'text-emerald-400' },
  stable:    { icon: Minus,        label: 'Stable',    color: 'text-muted-foreground/70' },
  degrading: { icon: TrendingUp,   label: 'Degrading', color: 'text-red-400' },
};

export function PromptPerformanceCard({ personaId, onOpenLab }: PromptPerformanceCardProps) {
  const { errorRates, trend, versionComparison, loading, error, refresh } = usePromptPerformanceSummary(personaId);
  const fetchDetail = usePersonaStore((s) => s.fetchDetail);
  const addToast = useToastStore((s) => s.addToast);
  const [rollingBack, setRollingBack] = useState(false);
  const [autoRollbackEnabled, setAutoRollbackEnabled] = useState(false);
  const [autoRollbackLoading, setAutoRollbackLoading] = useState(true);

  // Load persisted auto-rollback setting
  useEffect(() => {
    getAppSetting(`${AUTO_ROLLBACK_KEY_PREFIX}${personaId}`)
      .then((val) => setAutoRollbackEnabled(val === 'true'))
      .catch(() => {})
      .finally(() => setAutoRollbackLoading(false));
  }, [personaId]);

  const toggleAutoRollback = useCallback(async () => {
    const newValue = !autoRollbackEnabled;
    setAutoRollbackEnabled(newValue);
    try {
      await setAppSetting(`${AUTO_ROLLBACK_KEY_PREFIX}${personaId}`, String(newValue));
      addToast(
        newValue ? 'Auto-rollback enabled' : 'Auto-rollback disabled',
        'success',
      );
    } catch {
      setAutoRollbackEnabled(!newValue); // revert on failure
      addToast('Failed to save auto-rollback setting', 'error');
    }
  }, [autoRollbackEnabled, personaId, addToast]);

  const handleRollback = async () => {
    if (!versionComparison) return;
    setRollingBack(true);
    try {
      await rollbackPromptVersion(versionComparison.previous.id);
      await fetchDetail(personaId);
      addToast(`Rolled back to v${versionComparison.previous.version_number}`, 'success');
      refresh();
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Rollback failed', 'error');
    } finally {
      setRollingBack(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 text-muted-foreground/40 animate-spin" />
          <span className="text-sm text-muted-foreground/60">Loading performance...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-400/70" />
          <span className="text-sm text-red-300/80">{error}</span>
          <button onClick={refresh} className="ml-auto text-sm text-primary/70 hover:text-primary">Retry</button>
        </div>
      </div>
    );
  }

  if (errorRates.length === 0) {
    return (
      <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground/50" />
          <span className="text-sm text-muted-foreground/50">No execution data yet</span>
        </div>
      </div>
    );
  }

  const trendInfo = TREND_CONFIG[trend];
  const TrendIcon = trendInfo.icon;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary/70" />
          <h4 className="text-sm font-medium text-foreground/80">Prompt Performance</h4>
        </div>
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 text-sm ${trendInfo.color}`}>
            <TrendIcon className="w-3.5 h-3.5" />
            <span>{trendInfo.label}</span>
          </div>
          {onOpenLab && (
            <button
              onClick={onOpenLab}
              className="flex items-center gap-1 text-sm text-primary/60 hover:text-primary transition-colors"
              title="Open full dashboard in Lab"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error Rate Windows */}
      <div className="grid grid-cols-3 gap-2">
        {errorRates.map(({ window, rate }) => {
          const isHigh = rate > 0.2;
          const isMedium = rate > 0.05 && rate <= 0.2;
          return (
            <div
              key={window}
              className="p-2 rounded-lg bg-secondary/40 border border-primary/8"
            >
              <div className="text-[11px] text-muted-foreground/50 mb-0.5 uppercase tracking-wider">
                {window}
              </div>
              <div
                className={`text-sm font-semibold font-mono ${
                  isHigh ? 'text-red-400' : isMedium ? 'text-amber-400' : 'text-emerald-400'
                }`}
              >
                {fmtPct(rate)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Version Comparison */}
      {versionComparison && (
        <div
          className={`rounded-lg border p-3 space-y-2 ${
            versionComparison.isWorse
              ? 'border-red-500/20 bg-red-500/5'
              : 'border-primary/8 bg-secondary/30'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground/70">
              v{versionComparison.current.version_number} vs v{versionComparison.previous.version_number}
            </span>
            {versionComparison.isWorse && (
              <span className="text-[11px] font-medium text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded-full">
                Regression
              </span>
            )}
          </div>
          <div className="flex items-center gap-4 text-sm">
            <div>
              <span className="text-muted-foreground/50">Current: </span>
              <span className={`font-mono font-medium ${versionComparison.currentErrorRate > 0.1 ? 'text-red-400' : 'text-foreground/80'}`}>
                {fmtPct(versionComparison.currentErrorRate)}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground/50">Previous: </span>
              <span className="font-mono font-medium text-foreground/80">
                {fmtPct(versionComparison.previousErrorRate)}
              </span>
            </div>
          </div>

          {/* Rollback button */}
          {versionComparison.isWorse && (
            <button
              onClick={() => void handleRollback()}
              disabled={rollingBack}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
            >
              {rollingBack ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RotateCcw className="w-3.5 h-3.5" />
              )}
              Rollback to v{versionComparison.previous.version_number}
            </button>
          )}
        </div>
      )}

      {/* Auto-Rollback (Pro Feature) */}
      <div className="rounded-lg border border-primary/8 bg-secondary/30 p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-violet-400/70" />
            <span className="text-sm text-muted-foreground/70">Auto-rollback</span>
            <span className="text-[10px] font-medium text-violet-400 bg-violet-500/10 px-1.5 py-0.5 rounded-full border border-violet-500/20 flex items-center gap-0.5">
              <Lock className="w-2.5 h-2.5" />
              Pro
            </span>
          </div>
          <button
            onClick={() => void toggleAutoRollback()}
            disabled={autoRollbackLoading}
            className={`relative w-8 h-[18px] rounded-full transition-colors ${
              autoRollbackEnabled ? 'bg-violet-500/30' : 'bg-secondary/60'
            } disabled:opacity-50`}
            title="Auto-rollback when error rate exceeds 2x the previous version"
          >
            <div
              className={`absolute top-0.5 w-3.5 h-3.5 rounded-full transition-all ${
                autoRollbackEnabled
                  ? 'left-[calc(100%-18px)] bg-violet-400'
                  : 'left-0.5 bg-muted-foreground/40'
              }`}
            />
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground/60 mt-1.5">
          Automatically rollback if error rate exceeds 2x the previous version&apos;s rate.
        </p>
      </div>
    </div>
  );
}
