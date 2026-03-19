import { useState } from 'react';
import { Shield, ChevronDown, ChevronRight, Gauge, Clock, Layers } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  type TriggerRateLimitConfig,
  DEFAULT_RATE_LIMIT,
  RATE_LIMIT_WINDOW_OPTIONS,
  hasActiveRateLimit,
} from '@/lib/utils/platform/triggerConstants';
import type { TriggerRateLimitState } from '@/stores/slices/pipeline/triggerSlice';

interface RateLimitControlsProps {
  rateLimit: TriggerRateLimitConfig;
  runtimeState?: TriggerRateLimitState | null;
  onChange: (updated: TriggerRateLimitConfig) => void;
}

export function RateLimitControls({ rateLimit, runtimeState, onChange }: RateLimitControlsProps) {
  const [expanded, setExpanded] = useState(false);
  const active = hasActiveRateLimit(rateLimit);

  const update = (patch: Partial<TriggerRateLimitConfig>) => {
    onChange({ ...rateLimit, ...patch });
  };

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Shield className="w-3 h-3" />
        Rate Limiting
        {active && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-sm bg-amber-500/15 text-amber-400 font-medium">
            Active
          </span>
        )}
        {runtimeState?.isThrottled && (
          <span className="ml-1 px-1.5 py-0.5 rounded-full text-sm bg-red-500/15 text-red-400 font-medium animate-pulse">
            Throttled
          </span>
        )}
        {runtimeState && runtimeState.queueDepth > 0 && (
          <span className="ml-auto text-sm text-amber-400/70">
            {runtimeState.queueDepth} queued
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pl-5 pt-1">
              {/* Max per window */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground/70">
                  <Gauge className="w-3 h-3" />
                  Max executions
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={rateLimit.max_per_window}
                    onChange={(e) => update({ max_per_window: Math.max(0, parseInt(e.target.value) || 0) })}
                    className="w-20 px-2 py-1 text-sm bg-background/50 border border-primary/10 rounded-lg text-foreground/80 focus-ring"
                    placeholder="0"
                  />
                  <select
                    value={rateLimit.window_seconds}
                    onChange={(e) => update({ window_seconds: parseInt(e.target.value) })}
                    className="px-2 py-1 text-sm bg-background/50 border border-primary/10 rounded-lg text-foreground/80 focus-ring"
                  >
                    {RATE_LIMIT_WINDOW_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
                <p className="text-sm text-muted-foreground/50">0 = unlimited</p>
              </div>

              {/* Cooldown */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground/70">
                  <Clock className="w-3 h-3" />
                  Cooldown between firings (seconds)
                </label>
                <input
                  type="number"
                  min={0}
                  max={86400}
                  value={rateLimit.cooldown_seconds}
                  onChange={(e) => update({ cooldown_seconds: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-24 px-2 py-1 text-sm bg-background/50 border border-primary/10 rounded-lg text-foreground/80 focus-ring"
                  placeholder="0"
                />
              </div>

              {/* Max concurrent */}
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-sm text-muted-foreground/70">
                  <Layers className="w-3 h-3" />
                  Max concurrent executions
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={rateLimit.max_concurrent}
                  onChange={(e) => update({ max_concurrent: Math.max(0, parseInt(e.target.value) || 0) })}
                  className="w-24 px-2 py-1 text-sm bg-background/50 border border-primary/10 rounded-lg text-foreground/80 focus-ring"
                  placeholder="0"
                />
                <p className="text-sm text-muted-foreground/50">0 = unlimited</p>
              </div>

              {/* Runtime stats when active */}
              {runtimeState && active && (
                <div className="rounded-lg border border-primary/8 bg-background/30 p-2 space-y-1 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground/70">
                    <span>Window usage</span>
                    <span className="font-mono">
                      {runtimeState.firingTimestamps.length}
                      {rateLimit.max_per_window > 0 ? ` / ${rateLimit.max_per_window}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground/70">
                    <span>Concurrent</span>
                    <span className="font-mono">
                      {runtimeState.concurrentCount}
                      {rateLimit.max_concurrent > 0 ? ` / ${rateLimit.max_concurrent}` : ''}
                    </span>
                  </div>
                  {runtimeState.queueDepth > 0 && (
                    <div className="flex items-center justify-between text-amber-400/80">
                      <span>Queued</span>
                      <span className="font-mono">{runtimeState.queueDepth}</span>
                    </div>
                  )}
                  {runtimeState.cooldownUntil > Date.now() && (
                    <div className="flex items-center justify-between text-amber-400/80">
                      <span>Cooldown</span>
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
                  className="text-sm text-muted-foreground/50 hover:text-muted-foreground/70 transition-colors"
                >
                  Clear all limits
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
