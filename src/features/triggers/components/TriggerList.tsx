import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import * as api from '@/api/tauriApi';
import { getTriggerHealthMap } from '@/api/triggers';
import type { PersonaTrigger } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatTimestamp, formatCountdown } from '@/lib/utils/formatters';

type TriggerHealth = 'healthy' | 'degraded' | 'failing' | 'unknown';

const HEALTH_STYLES: Record<TriggerHealth, string> = {
  healthy: 'bg-emerald-400 animate-[health-pulse_2s_ease-in-out_infinite]',
  degraded: 'bg-amber-400',
  failing: 'bg-red-400 animate-[health-pulse_1.5s_ease-in-out_infinite]',
  unknown: 'bg-muted-foreground/20',
};

const HEALTH_TITLES: Record<TriggerHealth, string> = {
  healthy: 'Healthy — last 3 runs succeeded',
  degraded: 'Degraded — 1 recent failure',
  failing: 'Failing — 2+ consecutive failures',
  unknown: 'No execution history',
};

function HealthDot({ health }: { health: TriggerHealth }) {
  if (health === 'unknown') return null;
  return (
    <span
      title={HEALTH_TITLES[health]}
      className={`inline-block w-1.5 h-1.5 rounded-full flex-shrink-0 ${HEALTH_STYLES[health]}`}
    />
  );
}

/** Compute the next trigger time in ms (epoch), or null if not applicable. */
function getNextTriggerMs(trigger: PersonaTrigger): number | null {
  if (!trigger.enabled) return null;
  if (trigger.trigger_type === 'manual' || trigger.trigger_type === 'webhook' || trigger.trigger_type === 'chain') return null;

  // Prefer the backend-computed next_trigger_at (works for cron + interval triggers)
  if (trigger.next_trigger_at) {
    const nextMs = new Date(trigger.next_trigger_at).getTime();
    if (!isNaN(nextMs)) return nextMs;
  }

  // Fallback: compute from last_triggered_at + interval_seconds
  if (trigger.last_triggered_at && trigger.config) {
    const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
    if ((config.type === 'schedule' || config.type === 'polling') && config.interval_seconds) {
      const lastTrigger = new Date(trigger.last_triggered_at).getTime();
      return lastTrigger + config.interval_seconds * 1000;
    }
  }
  return null;
}

/** Compute the total interval (in seconds) for progress fraction. */
function getTotalIntervalSeconds(trigger: PersonaTrigger): number {
  // From parsed config
  if (trigger.config) {
    const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
    if ((config.type === 'schedule' || config.type === 'polling') && config.interval_seconds) {
      return config.interval_seconds;
    }
  }
  // From next_trigger_at - last_triggered_at
  if (trigger.next_trigger_at && trigger.last_triggered_at) {
    const nextMs = new Date(trigger.next_trigger_at).getTime();
    const lastMs = new Date(trigger.last_triggered_at).getTime();
    if (!isNaN(nextMs) && !isNaN(lastMs) && nextMs > lastMs) {
      return Math.floor((nextMs - lastMs) / 1000);
    }
  }
  return 300; // fallback 5 minutes
}

// ── Trigger-type color → SVG stroke color mapping ────────────────
const TRIGGER_RING_COLORS: Record<string, string> = {
  'text-amber-400': '#fbbf24',
  'text-teal-400': '#2dd4bf',
  'text-blue-400': '#60a5fa',
  'text-emerald-400': '#34d399',
  'text-purple-400': '#c084fc',
  'text-cyan-400': '#22d3ee',
};

// ── Radial Countdown Ring ────────────────────────────────────────
const RING_SIZE = 36;
const RING_STROKE = 3;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function RadialCountdownRing({
  remaining,
  total,
  firing,
  accentColor,
  children,
}: {
  remaining: number;
  total: number;
  firing: boolean;
  accentColor: string;
  children: React.ReactNode;
}) {
  const progressRef = useRef<SVGCircleElement>(null);
  const rafRef = useRef<number>(0);
  const startTimeRef = useRef(Date.now());
  const startRemainingRef = useRef(remaining);

  // Reset animation reference point when remaining jumps (e.g. trigger recalculation)
  useEffect(() => {
    startTimeRef.current = Date.now();
    startRemainingRef.current = remaining;
  }, [remaining]);

  // Smooth progress via requestAnimationFrame
  useEffect(() => {
    if (firing) return;

    const animate = () => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const currentRemaining = Math.max(startRemainingRef.current - elapsed, 0);
      const fraction = total > 0 ? Math.max(currentRemaining / total, 0) : 0;
      const offset = RING_CIRCUMFERENCE * (1 - fraction);

      if (progressRef.current) {
        progressRef.current.style.strokeDashoffset = `${offset}`;
      }
      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [total, firing]);

  const strokeColor = firing ? '#34d399' : accentColor;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg
        width={RING_SIZE}
        height={RING_SIZE}
        className={`-rotate-90 ${firing ? 'animate-pulse' : ''}`}
      >
        {/* Track */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="text-primary/8"
        />
        {/* Progress */}
        <circle
          ref={progressRef}
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={RING_CIRCUMFERENCE}
          style={{ transition: firing ? 'stroke 0.3s' : 'none' }}
        />
      </svg>
      {/* Text label centered inside */}
      <div className="absolute inset-0 flex items-center justify-center">
        {children}
      </div>
    </div>
  );
}

/** Live countdown for schedule/polling triggers */
function TriggerCountdown({ trigger, accentColorClass }: { trigger: PersonaTrigger; accentColorClass: string }) {
  const computeRemaining = useCallback(() => {
    const nextMs = getNextTriggerMs(trigger);
    if (nextMs === null) return null;
    return Math.floor((nextMs - Date.now()) / 1000);
  }, [trigger]);

  const [remaining, setRemaining] = useState(computeRemaining);
  const [firing, setFiring] = useState(false);

  useEffect(() => {
    setRemaining(computeRemaining());
    setFiring(false);
  }, [computeRemaining]);

  useEffect(() => {
    if (remaining === null) return;

    const id = setInterval(() => {
      setRemaining((prev) => {
        if (prev === null) return null;
        const next = prev - 1;
        if (next <= 0) {
          setFiring(true);
          setTimeout(() => setFiring(false), 2000);
          // Re-calculate after firing animation
          const fresh = computeRemaining();
          return fresh !== null ? Math.max(fresh, 0) : 0;
        }
        return next;
      });
    }, 1000);

    return () => clearInterval(id);
  }, [remaining === null, computeRemaining]);

  if (!trigger.enabled) return <span className="text-xs text-muted-foreground/70">Disabled</span>;
  if (trigger.trigger_type === 'manual') return <span className="text-xs text-muted-foreground/70">Manual</span>;
  if (trigger.trigger_type === 'webhook') return <span className="text-xs text-muted-foreground/70">Webhook</span>;
  if (trigger.trigger_type === 'chain') return <span className="text-xs text-muted-foreground/70">Chain</span>;
  if (remaining === null) return <span className="text-xs text-muted-foreground/70">Pending</span>;

  const total = getTotalIntervalSeconds(trigger);
  const accentColor = TRIGGER_RING_COLORS[accentColorClass] ?? '#c084fc';

  if (firing || remaining <= 0) {
    return (
      <RadialCountdownRing remaining={0} total={total} firing accentColor={accentColor}>
        <span className="text-[8px] font-semibold text-emerald-400 leading-none">Fire</span>
      </RadialCountdownRing>
    );
  }

  // Compact label: use short format for the ring interior
  const compactLabel = remaining >= 3600
    ? `${Math.floor(remaining / 3600)}h`
    : remaining >= 60
      ? `${Math.floor(remaining / 60)}m`
      : `${remaining}s`;

  return (
    <RadialCountdownRing remaining={remaining} total={total} firing={false} accentColor={accentColor}>
      <span className="text-[8px] font-mono font-semibold text-foreground/70 leading-none" title={`in ${formatCountdown(remaining)}`}>
        {compactLabel}
      </span>
    </RadialCountdownRing>
  );
}

interface TriggerListProps {
  onNavigateToPersona?: (personaId: string) => void;
}

export function TriggerList({ onNavigateToPersona }: TriggerListProps) {
  const personas = usePersonaStore((state) => state.personas);
  const [allTriggers, setAllTriggers] = useState<Record<string, PersonaTrigger[]>>({});
  const [triggerHealthMap, setTriggerHealthMap] = useState<Record<string, TriggerHealth>>({});

  useEffect(() => {
    let stale = false;

    const fetchAllTriggers = async () => {
      try {
        // Single IPC call for triggers + single IPC call for health (replaces N+1)
        const [triggers, healthMap] = await Promise.all([
          api.listAllTriggers(),
          getTriggerHealthMap(),
        ]);
        if (stale) return;

        const triggersMap: Record<string, PersonaTrigger[]> = {};
        for (const trigger of triggers) {
          const arr = triggersMap[trigger.persona_id] ?? (triggersMap[trigger.persona_id] = []);
          arr.push(trigger);
        }
        setAllTriggers(triggersMap);
        setTriggerHealthMap(healthMap as Record<string, TriggerHealth>);
      } catch (error) {
        console.error('Failed to fetch triggers:', error);
        if (!stale) {
          setAllTriggers({});
          setTriggerHealthMap({});
        }
      }
    };

    if (personas.length > 0) {
      fetchAllTriggers();
    } else {
      setAllTriggers({});
      setTriggerHealthMap({});
    }

    return () => { stale = true; };
  }, [personas]);

  const groupedTriggers = useMemo(() => {
    const groups: Record<string, { persona: typeof personas[0]; triggers: PersonaTrigger[] }> = {};

    personas.forEach((persona) => {
      const personaTriggers = allTriggers[persona.id] || [];
      if (personaTriggers.length > 0) {
        groups[persona.id] = { persona, triggers: personaTriggers };
      }
    });

    return groups;
  }, [personas, allTriggers]);


  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto flex flex-col">
        {Object.keys(groupedTriggers).length === 0 ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center text-muted-foreground/80 text-sm">
              No triggers configured yet
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Event Triggers</h3>

            {Object.values(groupedTriggers).map(({ persona, triggers }) => (
              <div key={persona.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-foreground/80">{persona.name}</h4>
                  {onNavigateToPersona && (
                    <button
                      onClick={() => onNavigateToPersona(persona.id)}
                      className="text-sm text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
                    >
                      Configure
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="space-y-1.5">
                  {triggers.map((trigger) => {
                    const meta = TRIGGER_TYPE_META[trigger.trigger_type] || DEFAULT_TRIGGER_META;
                    const Icon = meta.Icon;
                    const colorClass = meta.color;

                    return (
                      <motion.div
                        key={trigger.id}
                        role="button"
                        tabIndex={0}
                        whileHover={{ x: 4 }}
                        whileFocus={{ x: 4 }}
                        onClick={() => onNavigateToPersona?.(persona.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onNavigateToPersona?.(persona.id);
                          }
                        }}
                        className="p-3 bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-xl cursor-pointer hover:border-primary/20 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 ${colorClass}`} />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium capitalize ${colorClass}`}>
                                {trigger.trigger_type}
                              </span>
                              <span className={`text-sm px-1.5 py-0.5 rounded-md font-mono ${
                                trigger.enabled
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-secondary/60 text-muted-foreground/80 border border-border/20'
                              }`}>
                                {trigger.enabled ? 'On' : 'Off'}
                              </span>
                              <HealthDot health={triggerHealthMap[trigger.id] ?? 'unknown'} />
                            </div>

                            <div className="mt-1.5 text-sm text-muted-foreground/80 space-y-0.5">
                              <div>Last: {formatTimestamp(trigger.last_triggered_at, 'Never')}</div>
                              {trigger.trigger_type === 'webhook' && (
                                <div className="font-mono text-sm text-muted-foreground/80 truncate mt-0.5">
                                  localhost:9420/webhook/{trigger.id.slice(0, 8)}...
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Radial countdown ring */}
                          <div className="flex-shrink-0 mt-0.5">
                            <TriggerCountdown trigger={trigger} accentColorClass={colorClass} />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
