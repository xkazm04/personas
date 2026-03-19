import { useState, useEffect, useCallback } from 'react';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp, History } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { getCircuitBreakerStatus } from '@/api/agents/executions';
import type { CircuitBreakerStatus } from '@/lib/bindings/CircuitBreakerStatus';
import type { CircuitTransitionEvent } from '@/lib/bindings/CircuitTransitionEvent';

const POLL_INTERVAL_MS = 10_000;

const PROVIDER_LABELS: Record<string, string> = {
  claude_code: 'Claude',
  codex_cli: 'Codex',
  gemini_cli: 'Gemini',
  copilot_cli: 'Copilot',
  global: 'Global',
};

const STATE_LABELS: Record<string, string> = {
  closed: 'Closed',
  open: 'Open',
  half_open: 'Half-open',
  paused: 'Paused',
};

function formatTransitionTime(timestamp: string): string {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    const now = Date.now();
    const diffMs = now - date.getTime();
    if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    return `${Math.floor(diffMs / 3_600_000)}h ago`;
  } catch {
    return timestamp;
  }
}

export function CircuitBreakerIndicator() {
  const [status, setStatus] = useState<CircuitBreakerStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      setStatus(await getCircuitBreakerStatus());
    } catch {
      // Silently ignore — widget is best-effort
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const id = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [fetchStatus]);

  // Listen for real-time global breaker trip event
  useEffect(() => {
    const unlisten = listen<CircuitBreakerStatus>('circuit-breaker-global-tripped', (event) => {
      setStatus(event.payload);
      setExpanded(true); // Auto-expand on global trip for visibility
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  // Listen for individual circuit breaker transitions — refresh status on any change
  useEffect(() => {
    const unlisten = listen<CircuitTransitionEvent>('circuit-breaker-transition', () => {
      fetchStatus();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [fetchStatus]);

  if (!status) return null;

  const openProviders = status.providers.filter((p) => p.isOpen);
  const hasIssue = openProviders.length > 0 || status.globalPaused;
  const totalTrips1h = status.providers.reduce((sum, p) => sum + p.tripCount1h, 0);

  // Don't render when everything is healthy and no recent trips
  if (!hasIssue && totalTrips1h === 0) return null;

  const borderColor = status.globalPaused
    ? 'border-red-500/20'
    : hasIssue
      ? 'border-amber-500/20'
      : 'border-muted-foreground/10';
  const bgColor = status.globalPaused
    ? 'bg-red-500/5'
    : hasIssue
      ? 'bg-amber-500/5'
      : 'bg-muted-foreground/5';

  return (
    <div className={`border ${borderColor} ${bgColor}rounded-xl typo-body`} data-testid="circuit-breaker-indicator">
      {/* Summary row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        {status.globalPaused ? (
          <ShieldAlert className="w-3.5 h-3.5 text-red-400 animate-pulse" />
        ) : hasIssue ? (
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
        ) : (
          <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground/60" />
        )}

        <span className={
          status.globalPaused ? 'text-red-400 font-medium'
            : hasIssue ? 'text-amber-400 font-medium'
              : 'text-muted-foreground/60 font-medium'
        }>
          {status.globalPaused
            ? 'All providers paused'
            : hasIssue
              ? `${openProviders.length} provider${openProviders.length > 1 ? 's' : ''} circuit-broken`
              : `${totalTrips1h} trip${totalTrips1h !== 1 ? 's' : ''} in last hour`}
        </span>

        <span className="ml-auto text-muted-foreground/50">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-2.5 space-y-1.5 border-t border-red-500/10 pt-2">
          {status.providers.map((p) => {
            const label = PROVIDER_LABELS[p.provider] ?? p.provider;
            const tripBadge = p.tripCount1h > 0 ? (
              <span className="text-muted-foreground/40 typo-caption ml-1">
                ({p.tripCount1h} trip{p.tripCount1h !== 1 ? 's' : ''}/1h)
              </span>
            ) : null;

            if (p.isOpen) {
              return (
                <div key={p.provider} className="flex items-center gap-2 typo-body">
                  <ShieldAlert className="w-3 h-3 text-red-400" />
                  <span className="text-red-400 font-mono">{label}</span>
                  <span className="text-muted-foreground/60">
                    {p.consecutiveFailures} failures — cooldown {Math.ceil(p.cooldownRemainingSecs)}s
                  </span>
                  {tripBadge}
                </div>
              );
            }
            if (p.consecutiveFailures > 0) {
              return (
                <div key={p.provider} className="flex items-center gap-2 typo-body">
                  <ShieldCheck className="w-3 h-3 text-amber-400" />
                  <span className="text-amber-400 font-mono">{label}</span>
                  <span className="text-muted-foreground/60">
                    {p.consecutiveFailures} failure{p.consecutiveFailures > 1 ? 's' : ''}
                  </span>
                  {tripBadge}
                </div>
              );
            }
            return (
              <div key={p.provider} className="flex items-center gap-2 typo-body">
                <ShieldCheck className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400 font-mono">{label}</span>
                <span className="text-muted-foreground/60">healthy</span>
                {tripBadge}
              </div>
            );
          })}

          {status.globalPaused && (
            <div className="mt-1.5 px-2 py-1.5 bg-red-500/10 border border-red-500/15 rounded-lg typo-body text-red-400">
              Global pause active — {status.globalFailureCount} total failures.
              {status.globalCooldownRemainingSecs > 0 &&
                ` Resumes in ${Math.ceil(status.globalCooldownRemainingSecs)}s.`}
            </div>
          )}

          {/* History toggle */}
          {status.recentTransitions.length > 0 && (
            <>
              <button
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1.5 typo-caption text-muted-foreground/50 hover:text-muted-foreground/70 mt-1"
              >
                <History className="w-3 h-3" />
                {showHistory ? 'Hide' : 'Show'} transition history ({status.recentTransitions.length})
              </button>

              {showHistory && (
                <div className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                  {status.recentTransitions.slice(0, 20).map((t, i) => (
                    <div key={i} className="flex items-center gap-2 typo-code text-muted-foreground/50">
                      <span className="w-12 text-right shrink-0">{formatTransitionTime(t.timestamp)}</span>
                      <span className="shrink-0">{PROVIDER_LABELS[t.provider] ?? t.provider}</span>
                      <span className="text-muted-foreground/30">
                        {STATE_LABELS[t.fromState] ?? t.fromState} → {STATE_LABELS[t.toState] ?? t.toState}
                      </span>
                      {t.failureCount > 0 && (
                        <span className="text-muted-foreground/30">({t.failureCount})</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
