import { useMemo, useState } from 'react';
import { Shield, ChevronDown, ChevronRight, Gauge, Clock, Layers } from 'lucide-react';
import {
  type TriggerRateLimitConfig,
  DEFAULT_RATE_LIMIT,
  getRateLimitWindowOptions,
  hasActiveRateLimit,
} from '@/lib/utils/platform/triggerConstants';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';
import { useTranslation } from '@/i18n/useTranslation';
import { NumberStepper } from '@/features/shared/components/forms/NumberStepper';
import Button from '@/features/shared/components/buttons/Button';

interface RateLimitControlsProps {
  rateLimit: TriggerRateLimitConfig;
  runtimeState?: TriggerRateLimitState | null;
  onChange: (updated: TriggerRateLimitConfig) => void;
}

export function RateLimitControls({ rateLimit, runtimeState, onChange }: RateLimitControlsProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const active = hasActiveRateLimit(rateLimit);
  // The translated accessor, not the frozen `RATE_LIMIT_WINDOW_OPTIONS`: the
  // `triggers.rate_per_*` keys exist in all 14 locales and were never read.
  const windowOptions = useMemo(() => getRateLimitWindowOptions(t), [t]);

  const update = (patch: Partial<TriggerRateLimitConfig>) => {
    onChange({ ...rateLimit, ...patch });
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        onClick={() => setExpanded(!expanded)}
        variant="ghost"
        size="sm"
        className="w-full"
        icon={expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      >
        <Shield className="w-3 h-3" />
        {t.triggers.rate_limiting}
        {active && (
        <span className="inline-flex items-center ml-1 typo-body text-status-warning">
        Active
        </span>
        )}
        {runtimeState?.isThrottled && (
        <span className="inline-flex items-center ml-1 typo-body text-status-error">
        Throttled
        </span>
        )}
        {runtimeState && runtimeState.queueDepth > 0 && (
        <span className="ml-auto typo-body text-status-warning">
        {runtimeState.queueDepth} queued
        </span>
        )}
      </Button>

      {expanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="space-y-3 pl-5 pt-1">
              {/* Max per window */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-ink-1">
                  <Gauge className="w-3 h-3" />
                  {t.triggers.max_executions}
                </label>
                <div className="flex items-center gap-2">
                  <NumberStepper
                    value={rateLimit.max_per_window}
                    onChange={(v) => update({ max_per_window: v ?? 0 })}
                    min={0}
                    max={1000}
                    ariaLabel={t.triggers.max_executions}
                    className="w-28"
                  />
                  <select
                    value={rateLimit.window_seconds}
                    onChange={(e) => update({ window_seconds: parseInt(e.target.value) })}
                    className="px-2 py-1 typo-body bg-background/50 border border-hair rounded-card text-ink-1 focus-ring"
                  >
                    {windowOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <p className="typo-body text-ink-1">{t.triggers.unlimited_hint}</p>
              </div>

              {/* Cooldown */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-ink-1">
                  <Clock className="w-3 h-3" />
                  {t.triggers.cooldown_label}
                </label>
                <NumberStepper
                  value={rateLimit.cooldown_seconds}
                  onChange={(v) => update({ cooldown_seconds: v ?? 0 })}
                  min={0}
                  max={86400}
                  step={10}
                  ariaLabel={t.triggers.cooldown_label}
                  className="w-32"
                />
              </div>

              {/* Max concurrent */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 typo-body text-ink-1">
                  <Layers className="w-3 h-3" />
                  {t.triggers.max_concurrent_label}
                </label>
                <NumberStepper
                  value={rateLimit.max_concurrent}
                  onChange={(v) => update({ max_concurrent: v ?? 0 })}
                  min={0}
                  max={100}
                  ariaLabel={t.triggers.max_concurrent_label}
                  className="w-24"
                />
                <p className="typo-body text-ink-1">{t.triggers.zero_unlimited}</p>
              </div>

              {/* Runtime stats when active */}
              {runtimeState && active && (
                <div className="rounded-card border border-primary/8 bg-background/30 p-2 space-y-1 typo-body">
                  <div className="flex items-center justify-between text-ink-1">
                    <span>{t.triggers.window_usage}</span>
                    <span className="font-mono">
                      {runtimeState.firingTimestamps.length}
                      {rateLimit.max_per_window > 0 ? ` / ${rateLimit.max_per_window}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-ink-1">
                    <span>{t.triggers.concurrent_label}</span>
                    <span className="font-mono">
                      {runtimeState.concurrentCount}
                      {rateLimit.max_concurrent > 0 ? ` / ${rateLimit.max_concurrent}` : ''}
                    </span>
                  </div>
                  {runtimeState.queueDepth > 0 && (
                    <div className="flex items-center justify-between text-status-warning">
                      <span>{t.triggers.queued_stat}</span>
                      <span className="font-mono">{runtimeState.queueDepth}</span>
                    </div>
                  )}
                  {runtimeState.cooldownUntil > Date.now() && (
                    <div className="flex items-center justify-between text-status-warning">
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
                <Button
                  type="button"
                  onClick={() => onChange({ ...DEFAULT_RATE_LIMIT })}
                  variant="ghost"
                  size="sm"
                >{t.triggers.clear_all_limits}</Button>
              )}
            </div>
          </div>
        )}
    </div>
  );
}
