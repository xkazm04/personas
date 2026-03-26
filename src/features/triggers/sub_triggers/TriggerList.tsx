import { useMemo, useState, useEffect } from 'react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useAgentStore } from "@/stores/agentStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("trigger-list");
import { ChevronRight, Zap, Shield } from 'lucide-react';
import { motion } from 'framer-motion';
import { listAllTriggers } from "@/api/pipeline/triggers";

import { getTriggerHealthMap } from '@/api/pipeline/triggers';
import type { PersonaTrigger } from '@/lib/types/types';
import { TRIGGER_TYPE_META, DEFAULT_TRIGGER_META, WEBHOOK_BASE_URL } from '@/lib/utils/platform/triggerConstants';
import { formatTimestamp } from '@/lib/utils/formatters';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import type { TriggerHealth } from './triggerListTypes';
import { HealthDot } from './HealthDot';
import { TriggerCountdown } from './TriggerCountdown';

interface TriggerListProps {
  onNavigateToPersona?: (personaId: string) => void;
}

export function TriggerList({ onNavigateToPersona }: TriggerListProps) {
  const personas = useAgentStore((state) => state.personas);
  const triggerRateLimits = usePipelineStore((s) => s.triggerRateLimits);
  const [allTriggers, setAllTriggers] = useState<Record<string, PersonaTrigger[]>>({});
  const [triggerHealthMap, setTriggerHealthMap] = useState<Record<string, TriggerHealth>>({});

  useEffect(() => {
    let stale = false;

    const fetchAllTriggers = async () => {
      try {
        // Single IPC call for triggers + single IPC call for health (replaces N+1)
        const [triggers, healthMap] = await Promise.all([
          listAllTriggers(),
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
        logger.error('Failed to fetch triggers', { error: String(error) });
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
            <EmptyState
              icon={Zap}
              title="No triggers configured yet"
              description="Triggers let your agents react to events automatically -- schedules, webhooks, file changes, and more."
              iconColor="text-amber-400/80"
              iconContainerClassName="bg-amber-500/10 border-amber-500/20"
              action={onNavigateToPersona ? {
                label: 'Create Your First Trigger',
                onClick: () => {
                  const firstPersona = personas[0];
                  if (firstPersona) onNavigateToPersona(firstPersona.id);
                },
              } : undefined}
            />
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
                        className="p-3 bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-xl cursor-pointer hover:border-primary/20 transition-all focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      >
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 ${colorClass}`} />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-medium capitalize ${colorClass}`}>
                                {trigger.trigger_type}
                              </span>
                              <span className={`text-sm px-1.5 py-0.5 rounded-lg font-mono ${
                                trigger.enabled
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-secondary/60 text-muted-foreground/80 border border-border/20'
                              }`}>
                                {trigger.enabled ? 'On' : 'Off'}
                              </span>
                              <HealthDot health={triggerHealthMap[trigger.id] ?? 'unknown'} />
                              {triggerRateLimits[trigger.id]?.isThrottled && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-sm bg-red-500/15 text-red-400 border border-red-500/20 font-medium">
                                  <Shield className="w-2.5 h-2.5" />
                                  Throttled
                                </span>
                              )}
                              {(triggerRateLimits[trigger.id]?.queueDepth ?? 0) > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full text-sm bg-amber-500/15 text-amber-400 border border-amber-500/20 font-mono">
                                  {triggerRateLimits[trigger.id]!.queueDepth} queued
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 text-sm text-muted-foreground/80 space-y-0.5">
                              <div>Last: {formatTimestamp(trigger.last_triggered_at, 'Never')}</div>
                              {trigger.trigger_type === 'webhook' && (
                                <div className="font-mono text-sm text-muted-foreground/80 truncate mt-0.5">
                                  {WEBHOOK_BASE_URL.replace(/^https?:\/\//, '')}/webhook/{trigger.id.slice(0, 8)}...
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
