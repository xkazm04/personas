import { useState, useEffect, useCallback } from 'react';
import { RotateCcw, Shield } from 'lucide-react';
import { getPromptErrorRate } from '@/api/observability';

interface AutoRollbackSettingsProps {
  personaId: string;
}

export function AutoRollbackSettings({ personaId }: AutoRollbackSettingsProps) {
  const [errorRate, setErrorRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const fetchErrorRate = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const rate = await getPromptErrorRate(personaId, 10);
      setErrorRate(rate);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Failed to load error rate');
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    void fetchErrorRate();
  }, [fetchErrorRate]);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4 text-emerald-400" />
        <h4 className="text-sm font-medium text-foreground/80">Error Rate Monitor</h4>
      </div>
      {fetchError && (
        <p data-testid="error-rate-fetch-error" className="text-xs text-red-400">{fetchError}</p>
      )}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between text-xs text-muted-foreground/70 mb-1">
            <span>Last 10 executions</span>
            <span>{loading ? '...' : errorRate != null ? `${(errorRate * 100).toFixed(0)}%` : '—'}</span>
          </div>
          <div className="w-full h-2 rounded-full bg-secondary/60 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                errorRate != null && errorRate > 0.5
                  ? 'bg-red-400'
                  : errorRate != null && errorRate > 0.2
                    ? 'bg-amber-400'
                    : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.min((errorRate ?? 0) * 100, 100)}%` }}
            />
          </div>
        </div>
        <button
          onClick={() => void fetchErrorRate()}
          disabled={loading}
          data-testid="error-rate-refresh-btn"
          className="p-1.5 rounded-lg text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/40 transition-colors"
          title="Refresh error rate"
        >
          <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <p className="text-xs text-muted-foreground/50">
        If error rate exceeds 50% after a prompt change, rollback to the production version using the version list above.
      </p>
    </div>
  );
}
