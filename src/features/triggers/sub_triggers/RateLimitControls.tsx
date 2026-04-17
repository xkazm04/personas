import { useState } from 'react';
import { Shield, ChevronDown, ChevronRight, Gauge, Clock, Layers } from 'lucide-react';
import {
  type TriggerRateLimitConfig,
  DEFAULT_RATE_LIMIT,
  RATE_LIMIT_WINDOW_OPTIONS,
  hasActiveRateLimit,
} from '@/lib/utils/platform/triggerConstants';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';
import { useTranslation } from '@/i18n/useTranslation';

interface RateLimitControlsProps {
  rateLimit: TriggerRateLimitConfig;
  runtimeState?: TriggerRateLimitState | null;
  onChange: (updated: TriggerRateLimitConfig) => void;
}

export function RateLimitControls({ rateLimit, runtimeState, onChange }: RateLimitControlsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const active = hasActiveRateLimit(rateLimit);

  const update = (patch: Partial<TriggerRateLimitConfig>) => {
    onChange({ ...rateLimit, ...patch });
  };

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full typo-body text-foreground hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Shield className="w-3 h-3" />
        {t.triggers.rate_limiting}
        {active && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full typo-body bg-amber-500/15 text-amber-400 font-medium">
            Active
          </span>
        )}
        {runtimeState?.isThrottled && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full typo-body bg-red-500/15 text-red-400 font-medium animate-pulse">
            Throttled
          </span>
        )}
        {runtimeState && runtimeState.queueDepth > 0 && (
          <span className="ml-auto typo-body text-amber-400/70">
            {runtimeState.queueDepth} queued
          </span>
        )}
      </button>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="space-y-3 pl-5 pt-1">
              {/* Max per window */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-foreground">
                  <Gauge className="w-3 h-3" />
                  {t.triggers.max_executions}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={rateLimit.max_per_window}
                    onChange={(e) => update({ max_per_window: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-20 px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                    placeholder="0"
                  />
                  <select
                    value={rateLimit.window_seconds}
                    onChange={(e) => update({ window_seconds: parseInt(e.target.value) })}
                    className="px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                  >
                    {RATE_LIMIT_WINDOW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <p className="typo-body text-foreground">{t.triggers.unlimited_hint}</p>
              </div>

              {/* Cooldown */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-foreground">
                  <Clock className="w-3 h-3" />
                  {t.triggers.cooldown_label}
                </label>
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={rateLimit.cooldown_seconds}
                  onChange={(e) => update({ cooldown_seconds: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-24 px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                  placeholder="0"
                />
              </div>

              {/* Max concurrent */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-foreground">
                  <Layers className="w-3 h-3" />
                  {t.triggers.max_concurrent_label}
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={rateLimit.max_concurrent}
                  onChange={(e) => update({ max_concurrent: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-24 px-2 py-1 typo-body bg-background/50 border border-primary/10 rounded-card text-foreground focus-ring"
                  placeholder="0"
                />
                <p className="typo-body text-foreground">0 = unlimited</p>
              </div>

              {/* Runtime stats when active */}
              {runtimeState && active && (
                <div className="rounded-card border border-primary/8 bg-background/30 p-2 space-y-1 typo-body">
                  <div className="flex items-center justify-between text-foreground">
                    <span>{t.triggers.window_usage}</span>
                    <span className="font-mono">
                      {runtimeState.firingTimestamps.length}
                      {rateLimit.max_per_window > 0 ? ` / ${rateLimit.max_per_window}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-foreground">
                    <span>{t.triggers.concurrent_label}</span>
                    <span className="font-mono">
                      {runtimeState.concurrentCount}
                      {rateLimit.max_concurrent > 0 ? ` / ${rateLimit.max_concurrent}` : ''}
                    </span>
                  </div>
                  {runtimeState.queueDepth > 0 && (
                    <div className="flex items-center justify-between text-amber-400/80">
                      <span>{t.triggers.queued_stat}</span>
                      <span className="font-mono">{runtimeState.queueDepth}</span>
                    </div>
                  )}
                  {runtimeState.cooldownUntil > Date.now() && (
                    <div className="flex items-center justify-between text-amber-400/80">
                      <span>{t.triggers.cooldown_stat}</span>
                      <span className="font-mono">
                        {Math.ceil((runtimeState.cooldownUntil - Date.now()) / 1000)}s
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Reset button */}
              {active && (
                <button
                  onClick={() => onChange({ ...DEFAULT_RATE_LIMIT })}
                  className="typo-body text-foreground hover:text-muted-foreground/70 transition-colors"
                >
                  {t.triggers.clear_all_limits}
                </button>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
