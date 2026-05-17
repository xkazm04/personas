import { useMemo, useState, useEffect } from 'react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { useAgentStore } from "@/stores/agentStore";
import { createLogger } from "@/lib/log";

const logger = createLogger("trigger-list");
import { ChevronRight, Zap, Shield, Filter as FilterIcon } from 'lucide-react';
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
import { useTranslation } from '@/i18n/useTranslation';
import { useDensity } from '@/hooks/utility/data/useDensity';
import { DensityToggle } from '@/features/shared/components/display/DensityToggle';

interface TriggerListProps {
  onNavigateToPersona?: (personaId: string) => void;
}

type FilterChipId = 'all' | 'enabled' | 'disabled' | 'healthy' | 'degraded' | 'failing' | 'throttled';

export function TriggerList({ onNavigateToPersona }: TriggerListProps) {
  const { t, tx } = useTranslation();
  const personas = useAgentStore((state) => state.personas);
  const triggerRateLimits = usePipelineStore((s) => s.triggerRateLimits);
  const [allTriggers, setAllTriggers] = useState<Record<string, PersonaTrigger[]>>({});
  const [triggerHealthMap, setTriggerHealthMap] = useState<Record<string, TriggerHealth>>({});
  const [filter, setFilter] = useState<FilterChipId>('all');
  const { density, setDensity, tokens: densityTokens } = useDensity('trigger-list');

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

  const passesFilter = (trigger: PersonaTrigger): boolean => {
    switch (filter) {
      case 'all': return true;
      case 'enabled': return trigger.enabled;
      case 'disabled': return !trigger.enabled;
      case 'healthy': return triggerHealthMap[trigger.id] === 'healthy';
      case 'degraded': return triggerHealthMap[trigger.id] === 'degraded';
      case 'failing': return triggerHealthMap[trigger.id] === 'failing';
      case 'throttled': return !!triggerRateLimits[trigger.id]?.isThrottled;
    }
  };

  // Total counts per chip — derived from unfiltered allTriggers so the badges
  // stay stable as the user toggles chips. Without this the active-chip count
  // would always read 100% and the others would drop to 0, which is useless.
  const chipCounts = useMemo(() => {
    const flat = Object.values(allTriggers).flat();
    return {
      all: flat.length,
      enabled: flat.filter((t) => t.enabled).length,
      disabled: flat.filter((t) => !t.enabled).length,
      healthy: flat.filter((t) => triggerHealthMap[t.id] === 'healthy').length,
      degraded: flat.filter((t) => triggerHealthMap[t.id] === 'degraded').length,
      failing: flat.filter((t) => triggerHealthMap[t.id] === 'failing').length,
      throttled: flat.filter((t) => !!triggerRateLimits[t.id]?.isThrottled).length,
    };
  }, [allTriggers, triggerHealthMap, triggerRateLimits]);

  const hasAnyTriggers = chipCounts.all > 0;

  const groupedTriggers = useMemo(() => {
    const groups: Record<string, { persona: typeof personas[0]; triggers: PersonaTrigger[] }> = {};

    personas.forEach((persona) => {
      const personaTriggers = (allTriggers[persona.id] || []).filter(passesFilter);
      if (personaTriggers.length > 0) {
        groups[persona.id] = { persona, triggers: personaTriggers };
      }
    });

    return groups;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- passesFilter
    // captures filter+health+rate-limit state via closure; depending on those
    // directly is what we want.
  }, [personas, allTriggers, filter, triggerHealthMap, triggerRateLimits]);

  const chipDefs: { id: FilterChipId; label: string; tone: 'neutral' | 'emerald' | 'muted' | 'amber' | 'red' | 'red-strong' }[] = [
    { id: 'all', label: t.triggers.list.filter_all, tone: 'neutral' },
    { id: 'enabled', label: t.triggers.list.filter_enabled, tone: 'emerald' },
    { id: 'disabled', label: t.triggers.list.filter_disabled, tone: 'muted' },
    { id: 'healthy', label: t.triggers.list.filter_healthy, tone: 'emerald' },
    { id: 'degraded', label: t.triggers.list.filter_degraded, tone: 'amber' },
    { id: 'failing', label: t.triggers.list.filter_failing, tone: 'red' },
    { id: 'throttled', label: t.triggers.list.filter_throttled, tone: 'red-strong' },
  ];

  const CHIP_TONE_ACTIVE: Record<typeof chipDefs[number]['tone'], string> = {
    neutral: 'bg-primary/15 text-primary border-primary/30',
    emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
    muted: 'bg-secondary/60 text-foreground border-border/30',
    amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
    red: 'bg-red-500/15 text-red-400 border-red-500/30',
    'red-strong': 'bg-red-500/20 text-red-300 border-red-500/40',
  };


  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      <div className="flex-1 overflow-y-auto flex flex-col">
        {!hasAnyTriggers ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <EmptyState
              icon={Zap}
              title={t.triggers.list.empty_title}
              description={t.triggers.list.empty_hint}
              iconColor="text-amber-400/80"
              iconContainerClassName="bg-amber-500/10 border-amber-500/20"
              action={onNavigateToPersona ? {
                label: t.triggers.list.create_first,
                onClick: () => {
                  const firstPersona = personas[0];
                  if (firstPersona) onNavigateToPersona(firstPersona.id);
                },
              } : undefined}
            />
          </div>
        ) : (
          <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="typo-code font-mono text-foreground uppercase tracking-wider">{t.triggers.list.event_triggers}</h3>
              <DensityToggle density={density} onChange={setDensity} scopeId="trigger-list" />
            </div>

            {/* Filter chip row — single-select. Counts are over the full set so
                badges stay stable as the user toggles between chips. */}
            <div className="flex items-center gap-1.5 flex-wrap" role="toolbar" aria-label={t.triggers.list.filter_toolbar_label}>
              <FilterIcon className="w-3.5 h-3.5 text-foreground shrink-0 mr-0.5" />
              {chipDefs.map((chip) => {
                const isActive = filter === chip.id;
                const count = chipCounts[chip.id];
                const isDisabled = chip.id !== 'all' && count === 0 && !isActive;
                return (
                  <button
                    key={chip.id}
                    type="button"
                    onClick={() => setFilter(isActive ? 'all' : chip.id)}
                    disabled={isDisabled}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-modal typo-body transition-colors border ${
                      isActive
                        ? CHIP_TONE_ACTIVE[chip.tone]
                        : 'bg-secondary/30 text-foreground border-border/30 hover:bg-secondary/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-secondary/30'
                    }`}
                  >
                    <span>{chip.label}</span>
                    <span className="tabular-nums opacity-80">{count}</span>
                  </button>
                );
              })}
            </div>

            {Object.keys(groupedTriggers).length === 0 && (
              <div className="flex items-center justify-center py-12 typo-body text-foreground">
                {t.triggers.list.no_match_filter}
              </div>
            )}

            {Object.values(groupedTriggers).map(({ persona, triggers }) => (
              <div key={persona.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="typo-heading font-semibold text-foreground">{persona.name}</h4>
                  {onNavigateToPersona && (
                    <button
                      onClick={() => onNavigateToPersona(persona.id)}
                      className="typo-body text-primary hover:text-primary/80 flex items-center gap-1 transition-colors"
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
                        className={`${densityTokens.cardPadding} bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-modal cursor-pointer hover:border-primary/20 transition-all focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
                      >
                        <div className="flex items-start gap-2.5">
                          <Icon className={`w-4 h-4 mt-0.5 ${colorClass}`} />

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`typo-body font-medium capitalize ${colorClass}`}>
                                {trigger.trigger_type}
                              </span>
                              <span className={`typo-code px-1.5 py-0.5 rounded-card font-mono ${
                                trigger.enabled
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                  : 'bg-secondary/60 text-foreground border border-border/20'
                              }`}>
                                {trigger.enabled ? t.triggers.on_label : t.triggers.off_label}
                              </span>
                              <HealthDot health={triggerHealthMap[trigger.id] ?? 'unknown'} />
                              {triggerRateLimits[trigger.id]?.isThrottled && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full typo-body bg-red-500/15 text-red-400 border border-red-500/20 font-medium">
                                  <Shield className="w-2.5 h-2.5" />
                                  {t.triggers.throttled_label}
                                </span>
                              )}
                              {(triggerRateLimits[trigger.id]?.queueDepth ?? 0) > 0 && (
                                <span className="px-1.5 py-0.5 rounded-full typo-code bg-amber-500/15 text-amber-400 border border-amber-500/20 font-mono">
                                  {tx(t.triggers.queued_label, { count: triggerRateLimits[trigger.id]!.queueDepth })}
                                </span>
                              )}
                            </div>

                            <div className="mt-1.5 typo-body text-foreground space-y-0.5">
                              <div>{t.triggers.last_label} {formatTimestamp(trigger.last_triggered_at, 'Never')}</div>
                              {trigger.trigger_type === 'webhook' && (
                                <div className="font-mono typo-code text-foreground truncate mt-0.5">
                                  {WEBHOOK_BASE_URL.replace(/^https?:\/\//, '')}/{trigger.id.slice(0, 8)}...
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
