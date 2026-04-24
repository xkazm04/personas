import { useState, useEffect, useCallback, useRef } from 'react';
import { ShieldAlert, ShieldCheck, ChevronDown, ChevronUp, History } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { EventName } from '@/lib/eventRegistry';
import { getCircuitBreakerStatus } from '@/api/agents/executions';
import type { CircuitBreakerStatus } from '@/lib/bindings/CircuitBreakerStatus';
import type { CircuitTransitionEvent } from '@/lib/bindings/CircuitTransitionEvent';
import { useTranslation } from '@/i18n/useTranslation';

const POLL_INTERVAL_MS = 10_000;
const TRIP_PULSE_DURATION_MS = 1200;

export function CircuitBreakerIndicator() {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const cbTokens = t.status_tokens.circuit_breaker;

  const providerLabel = (provider: string): string => {
    const key = `provider_${provider}` as keyof typeof cbTokens;
    return cbTokens[key] ?? provider;
  };

  const formatTransitionTime = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return timestamp;
      const now = Date.now();
      const diffMs = now - date.getTime();
      if (diffMs < 60_000) return tx(t.execution.time_seconds_ago, { count: Math.floor(diffMs / 1000) });
      if (diffMs < 3_600_000) return tx(t.execution.time_minutes_ago, { count: Math.floor(diffMs / 60_000) });
      return tx(t.execution.time_hours_ago, { count: Math.floor(diffMs / 3_600_000) });
    } catch {
      return timestamp;
    }
  };

  const [status, setStatus] = useState<CircuitBreakerStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [pulse, setPulse] = useState(false);
  const prevGlobalPausedRef = useRef<boolean>(false);
  const pulseTimerRef = useRef<number | null>(null);

  const STATE_LABELS: Record<string, string> = {
    closed: e.cb_connected,
    open: e.cb_disconnected,
    half_open: e.cb_reconnecting,
    paused: e.cb_paused,
  };

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

  const triggerTripAttention = useCallback(() => {
    setExpanded(true);
    setPulse(true);
    if (pulseTimerRef.current != null) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulse(false), TRIP_PULSE_DURATION_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current != null) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  // Real-time global breaker trip — auto-expand + amber ring-pulse
  useEffect(() => {
    const unlisten = listen<CircuitBreakerStatus>(EventName.CIRCUIT_BREAKER_GLOBAL_TRIPPED, (event) => {
      setStatus(event.payload);
      triggerTripAttention();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [triggerTripAttention]);

  // Also fire the attention pulse when polled status flips into globalPaused
  useEffect(() => {
    const wasPaused = prevGlobalPausedRef.current;
    const isPaused = status?.globalPaused ?? false;
    if (!wasPaused && isPaused) triggerTripAttention();
    prevGlobalPausedRef.current = isPaused;
  }, [status?.globalPaused, triggerTripAttention]);

  // Listen for individual circuit breaker transitions — refresh status on any change
  useEffect(() => {
    const unlisten = listen<CircuitTransitionEvent>(EventName.CIRCUIT_BREAKER_TRANSITION, () => {
      fetchStatus();
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [fetchStatus]);

  // Skeleton reserves the slot during initial load — no layout jump.
  if (!status) {
    return (
      <div
        className="h-8 w-full rounded-card bg-secondary/20 animate-pulse"
        data-testid="circuit-breaker-indicator-skeleton"
        aria-hidden="true"
      />
    );
  }

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
  const pulseRing = pulse ? 'cb-trip-pulse' : '';

  return (
    <div
      className={`border ${borderColor} ${bgColor} rounded-modal typo-body transition-[height,padding] duration-200 ease-out ${pulseRing}`}
      data-testid="circuit-breaker-indicator"
    >
      <style>{`
        @keyframes cb-trip-pulse-kf {
          0%   { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0.55); }
          70%  { box-shadow: 0 0 0 8px rgba(251, 191, 36, 0); }
          100% { box-shadow: 0 0 0 0 rgba(251, 191, 36, 0); }
        }
        .cb-trip-pulse { animation: cb-trip-pulse-kf 1.2s ease-out 1; }
      `}</style>

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
          <ShieldCheck className="w-3.5 h-3.5 text-foreground" />
        )}

        <span className={
          status.globalPaused ? 'text-red-400 font-medium'
            : hasIssue ? 'text-amber-400 font-medium'
              : 'text-foreground font-medium'
        }>
          {status.globalPaused
            ? e.cb_all_paused
            : hasIssue
              ? tx(openProviders.length > 1 ? e.cb_providers_unavailable_other : e.cb_providers_unavailable_one, { count: openProviders.length })
              : tx(totalTrips1h !== 1 ? e.cb_interruptions_other : e.cb_interruptions_one, { count: totalTrips1h })}
        </span>

        <span className="ml-auto text-foreground">
          {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </span>
      </button>

      {/* Expanded detail — three titled sections with 12px gap */}
      {expanded && (
        <div className="px-3 pb-3 pt-2 border-t border-red-500/10 flex flex-col gap-3">
          {/* Global section */}
          <section>
            <h4 className="typo-caption uppercase tracking-wide text-muted-foreground mb-1.5">
              {e.cb_section_global}
            </h4>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 typo-body">
              <span className="text-muted-foreground">{e.cb_label_state}</span>
              <span className={`tabular-nums ${status.globalPaused ? 'text-red-400' : 'text-foreground'}`}>
                {status.globalPaused ? e.cb_paused : e.cb_connected}
              </span>
              <span className="text-muted-foreground">{e.cb_label_failures}</span>
              <span className="tabular-nums text-foreground">{status.globalFailureCount}</span>
              {status.globalPaused && status.globalCooldownRemainingSecs > 0 && (
                <>
                  <span className="text-muted-foreground">{e.cb_label_cooldown}</span>
                  <span className="tabular-nums text-foreground">{Math.ceil(status.globalCooldownRemainingSecs)}s</span>
                </>
              )}
            </div>
            {status.globalPaused && (
              <div className="mt-1.5 px-2 py-1.5 bg-red-500/10 border border-red-500/15 rounded-card typo-body text-red-400">
                {tx(e.cb_global_paused_detail, { count: status.globalFailureCount })}
                {status.globalCooldownRemainingSecs > 0 &&
                  ` ${tx(e.cb_resuming_in, { seconds: Math.ceil(status.globalCooldownRemainingSecs) })}`}
              </div>
            )}
          </section>

          {/* Providers section */}
          <section>
            <h4 className="typo-caption uppercase tracking-wide text-muted-foreground mb-1.5">
              {e.cb_section_providers}
            </h4>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 typo-body">
              {status.providers.map((p) => {
                const label = providerLabel(p.provider);
                let icon: React.ReactNode;
                let labelColor: string;
                let valueNode: React.ReactNode;
                if (p.isOpen) {
                  icon = <ShieldAlert className="w-3 h-3 text-red-400 shrink-0" />;
                  labelColor = 'text-red-400';
                  valueNode = (
                    <span className="tabular-nums text-foreground">
                      {tx(e.cb_errors_retrying, { count: p.consecutiveFailures, seconds: Math.ceil(p.cooldownRemainingSecs) })}
                      {p.tripCount1h > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          {tx(p.tripCount1h === 1 ? t.execution.interruptions_per_hour_one : t.execution.interruptions_per_hour_other, { count: p.tripCount1h })}
                        </span>
                      )}
                    </span>
                  );
                } else if (p.consecutiveFailures > 0) {
                  icon = <ShieldCheck className="w-3 h-3 text-amber-400 shrink-0" />;
                  labelColor = 'text-amber-400';
                  valueNode = (
                    <span className="tabular-nums text-foreground">
                      {tx(e.cb_errors, { count: p.consecutiveFailures })}
                      {p.tripCount1h > 0 && (
                        <span className="ml-1 text-muted-foreground">
                          {tx(p.tripCount1h === 1 ? t.execution.interruptions_per_hour_one : t.execution.interruptions_per_hour_other, { count: p.tripCount1h })}
                        </span>
                      )}
                    </span>
                  );
                } else {
                  icon = <ShieldCheck className="w-3 h-3 text-emerald-400 shrink-0" />;
                  labelColor = 'text-emerald-400';
                  valueNode = (
                    <span className="tabular-nums text-muted-foreground">
                      {e.cb_healthy}
                      {p.tripCount1h > 0 && (
                        <span className="ml-1">
                          {tx(p.tripCount1h === 1 ? t.execution.interruptions_per_hour_one : t.execution.interruptions_per_hour_other, { count: p.tripCount1h })}
                        </span>
                      )}
                    </span>
                  );
                }
                return (
                  <div key={p.provider} className="contents">
                    <span className={`flex items-center gap-1.5 font-mono ${labelColor}`}>
                      {icon}
                      {label}
                    </span>
                    {valueNode}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Recent transitions section */}
          {status.recentTransitions.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-1.5">
                <h4 className="typo-caption uppercase tracking-wide text-muted-foreground">
                  {e.cb_section_transitions}
                </h4>
                <button
                  onClick={() => setShowHistory((v) => !v)}
                  className="flex items-center gap-1.5 typo-caption text-muted-foreground hover:text-foreground"
                >
                  <History className="w-3 h-3" />
                  {showHistory ? tx(e.cb_hide_activity, { count: status.recentTransitions.length }) : tx(e.cb_show_activity, { count: status.recentTransitions.length })}
                </button>
              </div>
              {showHistory && (
                <div className="grid grid-cols-[auto_auto_1fr_auto] gap-x-3 gap-y-0.5 typo-code max-h-40 overflow-y-auto">
                  {status.recentTransitions.slice(0, 20).map((tr, i) => (
                    <div key={i} className="contents">
                      <span className="tabular-nums text-muted-foreground">{formatTransitionTime(tr.timestamp)}</span>
                      <span className="font-mono text-foreground">{providerLabel(tr.provider)}</span>
                      <span className="text-muted-foreground">
                        {STATE_LABELS[tr.fromState] ?? tr.fromState} → {STATE_LABELS[tr.toState] ?? tr.toState}
                      </span>
                      <span className="tabular-nums text-muted-foreground text-right">
                        {tr.failureCount > 0 ? tr.failureCount : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
