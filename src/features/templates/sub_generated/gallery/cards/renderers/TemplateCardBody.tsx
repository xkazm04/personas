import { useMemo } from 'react';
import { Clock, CircleDot } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { TRIGGER_ICONS } from './templateCardTypes';
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { ConnectorReadinessStatus } from '@/lib/types/designTypes';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { useTranslation } from '@/i18n/useTranslation';

interface TemplateCardBodyProps {
  connectors: string[];
  triggerTypes: string[];
  suggestedTriggers: SuggestedTrigger[];
  displayFlows: UseCaseFlow[];
  readinessStatuses: ConnectorReadinessStatus[];
  onViewFlows: () => void;
}

export function TemplateCardBody({
  connectors,
  triggerTypes,
  suggestedTriggers,
  displayFlows,
  readinessStatuses,
  onViewFlows,
}: TemplateCardBodyProps) {
  const { t } = useTranslation();
  const readinessMap = useMemo(
    () => new Map(readinessStatuses.map((s) => [s.connector_name, s])),
    [readinessStatuses],
  );

  return (
    <>
      {/* Compact Body (mobile) */}
      <div className="px-4 py-3 md:hidden border-t border-primary/5 space-y-2">
        <div className="flex items-center justify-between typo-body">
          <span className="text-muted-foreground/60">{t.templates.card.use_cases_label}</span>
          <span className="text-foreground/80">{displayFlows.length}</span>
        </div>
        <div className="flex items-center justify-between typo-body">
          <span className="text-muted-foreground/60">{t.templates.card.connectors_label}</span>
          <span className="text-foreground/80">{connectors.length}</span>
        </div>
        <div className="flex items-center justify-between typo-body">
          <span className="text-muted-foreground/60">{t.templates.card.triggers_label}</span>
          <span className="text-foreground/80">{suggestedTriggers.length > 0 ? suggestedTriggers.length : triggerTypes.length}</span>
        </div>
      </div>

      {/* 3-Column Body */}
      <div className="hidden md:grid px-4 py-4 md:grid-cols-2 lg:grid-cols-3 3xl:grid-cols-4 gap-4 border-t border-primary/5">
        {/* Use Cases */}
        <div className="min-w-0">
          <SectionLabel>{t.templates.card.use_cases_label}</SectionLabel>
          {displayFlows.length > 0 ? (
            <div className="space-y-1.5">
              {displayFlows.slice(0, 4).map((flow) => (
                <button
                  key={flow.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewFlows();
                  }}
                  className="flex items-center gap-2 w-full text-left group/flow hover:text-violet-300 transition-colors rounded-input focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background outline-none"
                >
                  <CircleDot className="w-3 h-3 text-violet-400/60 flex-shrink-0" />
                  <span className="typo-body text-foreground/70 group-hover/flow:text-violet-300 truncate">
                    {flow.name}
                  </span>
                </button>
              ))}
              {displayFlows.length > 4 && (
                <span className="typo-body text-muted-foreground/50 pl-5">
                  +{displayFlows.length - 4} more
                </span>
              )}
            </div>
          ) : (
            <span className="typo-body text-muted-foreground/60 italic">{t.templates.card.no_flows}</span>
          )}
        </div>

        {/* Connectors */}
        <div className="min-w-0">
          <SectionLabel>{t.templates.card.connectors_label}</SectionLabel>
          {connectors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {connectors.map((c) => {
                const meta = getConnectorMeta(c);
                const status = readinessMap.get(c);
                const isReady = status?.health === 'ready';
                return (
                  <Tooltip content={`${meta.label}${isReady ? '' : ' (not configured)'}`} placement="bottom">
                    <div
                      key={c}
                      className={`w-8 h-8 rounded-card flex items-center justify-center transition-opacity ${
                        isReady ? '' : 'opacity-30 grayscale'
                      }`}
                      style={{ backgroundColor: `${meta.color}18` }}
                    >
                      <ConnectorIcon meta={meta} size="w-4.5 h-4.5" />
                    </div>
                  </Tooltip>
                );
              })}
            </div>
          ) : (
            <span className="typo-body text-muted-foreground/60 italic">{t.templates.card.none_label}</span>
          )}
        </div>

        {/* Triggers */}
        <div className="min-w-0">
          <SectionLabel>{t.templates.card.triggers_label}</SectionLabel>
          {(triggerTypes.length > 0 || suggestedTriggers.length > 0) ? (
            <div className="space-y-1.5">
              {(suggestedTriggers.length > 0 ? suggestedTriggers : triggerTypes.map((t) => ({ trigger_type: t, description: t, config: {} }))).slice(0, 3).map((trigger, i) => {
                const TriggerIcon = TRIGGER_ICONS[trigger.trigger_type] ?? Clock;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <TriggerIcon className="w-3.5 h-3.5 text-blue-400/60 flex-shrink-0" />
                    <span className="typo-body text-foreground/70 truncate">
                      {trigger.description || trigger.trigger_type}
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <span className="typo-body text-muted-foreground/60 italic">{t.templates.card.none_label}</span>
          )}
        </div>
      </div>
    </>
  );
}
