/**
 * TriggerEditCell -- trigger configuration cell for PersonaMatrix edit mode.
 */
import { useMemo, useState, useRef } from 'react';
import { Pencil, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { AgentIR, SuggestedTrigger } from '@/lib/types/designTypes';
import type { MatrixEditState, MatrixEditCallbacks } from './matrixEditTypes';
import { TRIGGER_ICONS } from './matrixEditTypes';
import { getTriggerTypeLabel } from '@/lib/utils/platform/triggerConstants';

// -- Trigger Popup -----------------------------------------------------

function TriggerPopup({
  trigger,
  index,
  config,
  onConfigChange,
  onClose,
}: {
  trigger: SuggestedTrigger;
  index: number;
  config: Record<string, string>;
  onConfigChange: (index: number, config: Record<string, string>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const popupRef = useRef<HTMLDivElement>(null);
  useClickOutside(popupRef, true, onClose);

  const Icon = TRIGGER_ICONS[trigger.trigger_type];
  const isSchedule = trigger.trigger_type === 'schedule';
  const isWebhook = trigger.trigger_type === 'webhook';
  const isPolling = trigger.trigger_type === 'polling';

  const inputClass =
    'w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal text-sm text-foreground/90 placeholder-muted-foreground/30 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors';

  return (
    <div
      ref={popupRef}
      className="absolute left-0 right-0 top-full mt-1 z-50 rounded-modal border border-primary/15 bg-background shadow-elevation-3 p-3.5 space-y-2.5"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-amber-500/70" />
          <span className="text-sm font-medium text-foreground/80 capitalize">{trigger.trigger_type}</span>
        </div>
        <button type="button" onClick={onClose} className="p-0.5 rounded hover:bg-primary/10 transition-colors">
          <X className="w-3.5 h-3.5 text-muted-foreground/60" />
        </button>
      </div>

      {trigger.description && (
        <p className="text-sm text-muted-foreground/50 leading-relaxed">{trigger.description}</p>
      )}

      {isSchedule && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground/70">{t.templates.trigger_edit.schedule}</label>
          <input
            type="text"
            autoFocus
            value={config.schedule ?? config.cron ?? (trigger.config.cron as string | undefined) ?? trigger.description ?? ''}
            onChange={(e) => onConfigChange(index, { ...config, schedule: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onClose()}
            placeholder={t.templates.trigger_edit.schedule_placeholder}
            className={inputClass}
          />
          <p className="text-sm text-muted-foreground/40">Natural language or cron (e.g. "0 9 * * 1-5")</p>
        </div>
      )}

      {isWebhook && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground/70">{t.templates.trigger_edit.webhook_url}</label>
          <input
            type="text"
            autoFocus
            value={config.url ?? (trigger.config.url as string | undefined) ?? ''}
            onChange={(e) => onConfigChange(index, { ...config, url: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onClose()}
            placeholder="https://..."
            className={inputClass}
          />
        </div>
      )}

      {isPolling && (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground/70">{t.templates.trigger_edit.check_interval}</label>
          <input
            type="text"
            autoFocus
            value={config.interval ?? (trigger.config.interval as string | undefined) ?? ''}
            onChange={(e) => onConfigChange(index, { ...config, interval: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onClose()}
            placeholder={t.templates.trigger_edit.check_interval_placeholder}
            className={inputClass}
          />
        </div>
      )}

      {(trigger.trigger_type === 'manual' || trigger.trigger_type === 'event') && (
        <p className="text-sm text-muted-foreground/40 italic">{t.templates.trigger_edit.no_config_needed}</p>
      )}
    </div>
  );
}

// -- Trigger cell (edit mode) ------------------------------------------

interface TriggerEditCellProps {
  designResult: AgentIR;
  editState: MatrixEditState;
  callbacks: MatrixEditCallbacks;
}

export function TriggerEditCell({ designResult, editState, callbacks }: TriggerEditCellProps) {
  const triggers = designResult.suggested_triggers ?? [];
  const [openPopupIndex, setOpenPopupIndex] = useState<number | null>(null);

  // Deduplicate by type -- show one per type
  const uniqueTriggers = useMemo(() => {
    const seen = new Set<string>();
    return triggers
      .map((t, i) => ({ trigger: t, index: i }))
      .filter(({ trigger }) => {
        if (seen.has(trigger.trigger_type)) return false;
        seen.add(trigger.trigger_type);
        return true;
      });
  }, [triggers]);

  if (uniqueTriggers.length === 0) {
    return <span className="text-sm text-muted-foreground/50">Manual execution only</span>;
  }

  return (
    <div className="space-y-2 w-full">
      {uniqueTriggers.slice(0, 3).map(({ trigger, index }) => {
        const Icon = TRIGGER_ICONS[trigger.trigger_type];
        const config = editState.triggerConfigs[index] ?? {};
        const isSchedule = trigger.trigger_type === 'schedule';
        const hasConfig = isSchedule || trigger.trigger_type === 'webhook' || trigger.trigger_type === 'polling';
        const isOpen = openPopupIndex === index;

        // Compute display value
        let displayValue = getTriggerTypeLabel(trigger.trigger_type);
        if (isSchedule) {
          displayValue = config.schedule ?? config.cron ?? (trigger.config.cron as string | undefined) ?? trigger.description ?? 'Schedule';
        } else if (trigger.trigger_type === 'webhook') {
          const url = config.url ?? (trigger.config.url as string | undefined);
          displayValue = url || 'Webhook';
        } else if (trigger.trigger_type === 'polling') {
          displayValue = config.interval ?? (trigger.config.interval as string | undefined) ?? 'Polling';
        } else if (trigger.description.length > 3 && trigger.description.length <= 35) {
          displayValue = trigger.description;
        }

        return (
          <div key={index} className="relative">
            <div className="flex items-center gap-2">
              <Icon className="w-3.5 h-3.5 text-amber-500/70 flex-shrink-0" />
              {hasConfig ? (
                <button
                  type="button"
                  onClick={() => setOpenPopupIndex(isOpen ? null : index)}
                  className={[
                    'flex-1 min-w-0 text-left text-sm truncate py-0.5',
                    'border-b border-dashed border-amber-500/30',
                    'hover:border-amber-500/60 hover:text-foreground/90',
                    'transition-colors cursor-pointer',
                    'inline-flex items-center gap-1.5',
                    isOpen ? 'text-foreground/90 border-amber-500/60' : 'text-foreground/70',
                  ].join(' ')}
                >
                  <span className="truncate">{displayValue}</span>
                  <Pencil className="w-3 h-3 text-amber-500/40 flex-shrink-0" />
                </button>
              ) : (
                <span className="text-sm text-foreground/70 truncate">{displayValue}</span>
              )}
            </div>

            {isOpen && (
              <TriggerPopup
                trigger={trigger}
                index={index}
                config={config}
                onConfigChange={callbacks.onTriggerConfigChange}
                onClose={() => setOpenPopupIndex(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
