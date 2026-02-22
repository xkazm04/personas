import { useMemo, useState, useEffect, useCallback } from 'react';
import { usePersonaStore } from '@/stores/personaStore';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import * as api from '@/api/tauriApi';
import type { PersonaTrigger } from '@/lib/types/types';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, parseTriggerConfig } from '@/lib/utils/triggerConstants';
import { formatTimestamp, formatCountdown } from '@/lib/utils/formatters';

type TriggerHealth = 'healthy' | 'degraded' | 'failing' | 'unknown';

function deriveTriggerHealth(executions: PersonaExecution[]): TriggerHealth {
  if (executions.length === 0) return 'unknown';
  // Take the last 3 executions (most recent first)
  const recent = executions.slice(0, 3);
  const failures = recent.filter((e) => e.status === 'failed' || e.status === 'error');
  if (failures.length === 0) return 'healthy';
  // 2+ consecutive failures from the top = failing
  if (recent.length >= 2 && recent[0]!.status !== 'completed' && recent[1]!.status !== 'completed') return 'failing';
  return 'degraded';
}

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

  if (trigger.last_triggered_at && trigger.config) {
    const config = parseTriggerConfig(trigger.config);
    if (config.interval_seconds) {
      const lastTrigger = new Date(trigger.last_triggered_at).getTime();
      return lastTrigger + config.interval_seconds * 1000;
    }
  }
  return null;
}

/** Live countdown for schedule/polling triggers */
function TriggerCountdown({ trigger }: { trigger: PersonaTrigger }) {
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

  if (!trigger.enabled) return <span>Disabled</span>;
  if (trigger.trigger_type === 'manual') return <span>Manual only</span>;
  if (trigger.trigger_type === 'webhook') return <span>On webhook</span>;
  if (trigger.trigger_type === 'chain') return <span>On agent completion</span>;
  if (remaining === null) return <span>Pending</span>;

  if (firing) {
    return <span className="text-emerald-400 animate-pulse font-medium">Firing...</span>;
  }

  if (remaining <= 0) {
    return <span className="text-emerald-400 animate-pulse font-medium">Firing...</span>;
  }

  return <span>in {formatCountdown(remaining)}</span>;
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
        const triggers = await api.listAllTriggers();
        if (stale) return;

        const triggersMap: Record<string, PersonaTrigger[]> = {};
        for (const trigger of triggers) {
          const arr = triggersMap[trigger.persona_id] ?? (triggersMap[trigger.persona_id] = []);
          arr.push(trigger);
        }
        setAllTriggers(triggersMap);

        // Fetch recent executions per persona to derive trigger health
        const personaIds = [...new Set(triggers.map((t) => t.persona_id))];
        const healthMap: Record<string, TriggerHealth> = {};
        await Promise.all(
          personaIds.map(async (pid) => {
            try {
              const execs = await api.listExecutions(pid, 20);
              // Group executions by trigger_id, most recent first
              const byTrigger: Record<string, PersonaExecution[]> = {};
              for (const exec of execs) {
                if (exec.trigger_id) {
                  const arr = byTrigger[exec.trigger_id] ?? (byTrigger[exec.trigger_id] = []);
                  arr.push(exec);
                }
              }
              for (const [tid, texecs] of Object.entries(byTrigger)) {
                healthMap[tid] = deriveTriggerHealth(texecs);
              }
            } catch {
              // Silent — health remains unknown
            }
          }),
        );
        if (!stale) setTriggerHealthMap(healthMap);
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
                              <div>Next: <TriggerCountdown trigger={trigger} /></div>
                              {trigger.trigger_type === 'webhook' && (
                                <div className="font-mono text-sm text-muted-foreground/80 truncate mt-0.5">
                                  localhost:9420/webhook/{trigger.id.slice(0, 8)}...
                                </div>
                              )}
                            </div>
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
