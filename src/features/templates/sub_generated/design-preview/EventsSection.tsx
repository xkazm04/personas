import { Zap, ToggleLeft, ToggleRight } from 'lucide-react';
import { DesignCheckbox } from './DesignCheckbox';
import { triggerIconMeta, SECTION_LABEL } from './helpers';
import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';
import type { PersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig, type TriggerConfig } from '@/lib/utils/platform/triggerConstants';
import { useTranslation } from '@/i18n/useTranslation';

/** Human-readable detail line for a parsed trigger config. Returns the actual
 *  cadence/url/event so users see "0 9 * * MON" or "every 300s" instead of a
 *  bare "Schedule" label that the saved-design preview used to render. */
function formatTriggerDetail(cfg: TriggerConfig): string | null {
  switch (cfg.type) {
    case 'schedule': {
      const parts: string[] = [];
      if (cfg.cron) parts.push(cfg.cron);
      else if (cfg.interval_seconds) parts.push(`every ${formatSeconds(cfg.interval_seconds)}`);
      if (cfg.timezone) parts.push(cfg.timezone);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'polling': {
      const parts: string[] = [];
      if (cfg.interval_seconds) parts.push(`every ${formatSeconds(cfg.interval_seconds)}`);
      const url = cfg.url || cfg.endpoint;
      if (url) parts.push(url);
      return parts.length > 0 ? parts.join(' · ') : null;
    }
    case 'webhook':
      return cfg.event_type ? `Listens for ${cfg.event_type}` : null;
    case 'event_listener':
      return cfg.listen_event_type ? `On ${cfg.listen_event_type}` : null;
    case 'chain':
      return cfg.source_persona_id ? `After persona ${cfg.source_persona_id}` : null;
    case 'file_watcher': {
      const paths = (cfg.watch_paths ?? []).filter(Boolean);
      if (paths.length === 0) return cfg.glob_filter ?? null;
      return cfg.glob_filter ? `${paths.join(', ')} (${cfg.glob_filter})` : paths.join(', ');
    }
    case 'clipboard':
      return cfg.pattern ?? cfg.content_type ?? null;
    case 'app_focus':
      return (cfg.app_names ?? []).filter(Boolean).join(', ') || cfg.title_pattern || null;
    case 'composite':
      return (cfg.conditions ?? []).map((c) => c.event_type).filter(Boolean).join(` ${cfg.operator || 'AND'} `) || null;
    case 'manual':
    default:
      return null;
  }
}

function formatSeconds(s: number): string {
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

interface EventsSectionProps {
  result: AgentIR;
  selectedTriggerIndices: Set<number>;
  onTriggerToggle: (index: number) => void;
  suggestedSubscriptions?: Array<{ event_type: string; source_filter?: object; description: string }>;
  selectedSubscriptionIndices: Set<number>;
  onSubscriptionToggle?: (idx: number) => void;
  readOnly: boolean;
  actualTriggers: PersonaTrigger[];
  onTriggerEnabledToggle?: (triggerId: string, enabled: boolean) => void;
  anchorId?: string;
}

export function EventsSection({
  result,
  selectedTriggerIndices,
  onTriggerToggle,
  suggestedSubscriptions,
  selectedSubscriptionIndices,
  onSubscriptionToggle,
  readOnly,
  actualTriggers,
  onTriggerEnabledToggle,
  anchorId,
}: EventsSectionProps) {
  const { t } = useTranslation();
  const suggestedTriggers = result?.suggested_triggers ?? [];
  const hasTriggers = suggestedTriggers.length > 0 || (readOnly && actualTriggers.length > 0);
  const hasSubscriptions = suggestedSubscriptions && suggestedSubscriptions.length > 0;

  if (!hasTriggers && !hasSubscriptions) return null;

  return (
    <div id={anchorId} className="space-y-3">
      <div className={SECTION_LABEL}>
        <Zap className="w-4 h-4 text-amber-400" />
        {t.templates.design.events_and_triggers}
        <span className="typo-caption ml-1">{t.templates.design.what_activates}</span>
      </div>

      <div className={`bg-secondary/20 border border-primary/10 rounded-modal overflow-hidden ${
        hasTriggers && hasSubscriptions
          ? 'grid grid-cols-1 md:grid-cols-2 md:divide-x divide-primary/[0.06]'
          : 'divide-y divide-primary/[0.06]'
      }`}>
        {/* Triggers */}
        {hasTriggers && (
          <div className="p-3.5 space-y-2">
            <span className="typo-code font-mono uppercase tracking-wider text-foreground">{t.templates.design.triggers_section}</span>
            {readOnly && actualTriggers.length > 0 ? (
              actualTriggers.map((trigger) => {
                const config = parseTriggerConfig(trigger.trigger_type, trigger.config);
                const detail = formatTriggerDetail(config);
                return (
                  <div key={trigger.id} className="flex items-start gap-2.5 py-1">
                    <div className="flex-shrink-0 mt-0.5">{(() => { const { Icon, color } = triggerIconMeta(trigger.trigger_type as SuggestedTrigger['trigger_type']); return <Icon className={`w-4 h-4 ${color}`} />; })()}</div>
                    <div className="flex-1 min-w-0">
                      <span className="typo-body font-semibold text-foreground capitalize block">
                        {trigger.trigger_type.replace(/_/g, ' ')}
                      </span>
                      {detail && (
                        <span className="typo-caption text-primary/80 font-mono block leading-snug">
                          {detail}
                        </span>
                      )}
                    </div>
                    {onTriggerEnabledToggle && (
                      <button
                        onClick={() => onTriggerEnabledToggle(trigger.id, !trigger.enabled)}
                        className="flex-shrink-0 p-0.5 rounded transition-colors hover:bg-secondary/50"
                        title={trigger.enabled ? 'Disable' : 'Enable'}
                      >
                        {trigger.enabled ? (
                          <ToggleRight className="w-5 h-5 text-emerald-400" />
                        ) : (
                          <ToggleLeft className="w-5 h-5 text-foreground" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })
            ) : (
              suggestedTriggers.map((trigger, trigIdx) => {
                const isSelected = selectedTriggerIndices.has(trigIdx);
                return (
                  <div key={trigIdx} className="flex items-start gap-2.5 py-1">
                    {!readOnly && (
                      <div className="mt-0.5">
                        <DesignCheckbox
                          checked={isSelected}
                          onChange={() => onTriggerToggle(trigIdx)}
                        />
                      </div>
                    )}
                    <div className="flex-shrink-0 mt-0.5">{(() => { const { Icon, color } = triggerIconMeta(trigger.trigger_type); return <Icon className={`w-4 h-4 ${color}`} />; })()}</div>
                    <div className="flex-1 min-w-0">
                      <span className="typo-body font-semibold text-foreground capitalize block">{trigger.trigger_type}</span>
                      <span className="typo-caption leading-snug block">{trigger.description}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Event Subscriptions */}
        {hasSubscriptions && (
          <div className="p-3.5 space-y-2">
            <span className="typo-code font-mono uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Zap className="w-3 h-3 text-purple-400" />
              {t.templates.design.event_subscriptions}
            </span>
            {suggestedSubscriptions!.map((sub, subIdx) => {
              const isSelected = selectedSubscriptionIndices.has(subIdx);
              return (
                <div key={`sub-${subIdx}`} className="flex items-start gap-2.5 py-1">
                  {!readOnly && (
                    <div className="mt-0.5">
                      <DesignCheckbox
                        checked={!!isSelected}
                        onChange={() => onSubscriptionToggle?.(subIdx)}
                        color="purple"
                      />
                    </div>
                  )}
                  <Zap className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <span className="typo-body font-semibold text-foreground block">{sub.event_type}</span>
                    <span className="typo-caption leading-snug block">{sub.description}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
