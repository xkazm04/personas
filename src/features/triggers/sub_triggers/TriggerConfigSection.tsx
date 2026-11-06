import { Zap, AlertTriangle } from 'lucide-react';
import type { PersonaTrigger } from '@/lib/types/types';
import { parseTriggerConfig, getWebhookUrl, getPollingUrl, IS_WEBHOOK_LOCALHOST } from '@/lib/utils/platform/triggerConstants';
import { formatInterval } from '@/lib/utils/formatters';
import { CheckCircle2, Copy } from 'lucide-react';
import type { useTriggerDetail } from '@/features/triggers/hooks/useTriggerDetail';
import { useTranslation } from '@/i18n/useTranslation';

interface ConfigSectionProps {
  trigger: PersonaTrigger;
  credentialEventsList: { id: string; name: string }[];
  detail: ReturnType<typeof useTriggerDetail>;
}

export function ConfigSection({ trigger, credentialEventsList, detail }: ConfigSectionProps) {
  const { t } = useTranslation();
  const config = parseTriggerConfig(trigger.trigger_type, trigger.config);

  return (
    <div className="typo-body text-ink-1 space-y-1">
      {config.type === 'schedule' && config.cron && (
        <div>{t.triggers.cron_colon} <code className="inline-flex items-center typo-code">{config.cron}</code></div>
      )}
      {(config.type === 'schedule' || config.type === 'polling') && config.interval_seconds && !(config.type === 'schedule' && config.cron) && (
        <div>{t.triggers.interval_colon} {formatInterval(config.interval_seconds)}</div>
      )}
      {config.type === 'polling' && config.event_id && (
        <div className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-status-warning" />
          {t.triggers.event_colon} {credentialEventsList.find(e => e.id === config.event_id)?.name || config.event_id}
        </div>
      )}
      {config.type === 'polling' && getPollingUrl(config) && (
        <div className="truncate">{t.triggers.endpoint_colon} {getPollingUrl(config)}</div>
      )}
      {config.type === 'event_listener' && (
        <>
          <div>{t.triggers.listens_for_colon} <code className="inline-flex items-center typo-code">{config.listen_event_type || 'any'}</code></div>
          {config.source_filter && (
            <div>{t.triggers.source_filter_colon} <code className="inline-flex items-center typo-code">{config.source_filter}</code></div>
          )}
        </>
      )}
      {config.type === 'webhook' && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="flex-1 min-w-0 px-2.5 py-1.5 bg-background/50 border border-hair rounded-modal cursor-text select-all" onClick={(e) => e.stopPropagation()}>
              <span className="typo-code text-ink-1 break-all">{getWebhookUrl(trigger.id)}</span>
            </div>
            <button
              type="button"
              onClick={detail.copyWebhookUrl}
              className={`flex-shrink-0 p-1.5 rounded-card transition-all ${detail.copiedUrl ? 'bg-status-success/15 text-status-success' : 'hover:bg-surface-2 text-ink-1 hover:text-ink-3'}`}
              title={t.triggers.detail.webhook_url}
            >
              {detail.copiedUrl ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          </div>
          {config.webhook_secret && (
            <div className="typo-body text-ink-1">{t.triggers.hmac_colon} {'--------'}{config.webhook_secret.slice(-4)}</div>
          )}
          {IS_WEBHOOK_LOCALHOST && (
            <div className="flex items-center gap-1.5 typo-body text-status-warning mt-1">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              {t.triggers.dev_mode_warning}
            </div>
          )}
        </div>
      )}
      {config.type === 'file_watcher' && (
        <>
          {config.watch_paths && config.watch_paths.length > 0 && (
            <div>{t.triggers.paths_colon} {config.watch_paths.map((p, i) => (
              <code key={i} className="inline-flex items-center typo-code mr-1">{p}</code>
            ))}</div>
          )}
          {config.events && <div>{t.triggers.events_colon} {config.events.join(', ')}</div>}
          {config.recursive && <div>{t.triggers.recursive_yes}</div>}
          {config.glob_filter && <div>{t.triggers.filter_colon} <code className="inline-flex items-center typo-code">{config.glob_filter}</code></div>}
        </>
      )}
      {config.type === 'clipboard' && (
        <>
          <div>{t.triggers.watches_colon} {config.content_type || 'text'} content</div>
          {config.pattern && <div>{t.triggers.pattern_colon} <code className="inline-flex items-center typo-code">{config.pattern}</code></div>}
          {config.interval_seconds && <div>{t.triggers.poll_every} {config.interval_seconds}s</div>}
        </>
      )}
      {config.type === 'app_focus' && (
        <>
          {config.app_names && config.app_names.length > 0 && (
            <div>{t.triggers.apps_colon} {config.app_names.map((n, i) => (
              <code key={i} className="inline-flex items-center typo-code mr-1">{n}</code>
            ))}</div>
          )}
          {config.title_pattern && <div>{t.triggers.title_colon} <code className="inline-flex items-center typo-code">{config.title_pattern}</code></div>}
          {config.interval_seconds && <div>{t.triggers.poll_every} {config.interval_seconds}s</div>}
        </>
      )}
      {config.type === 'composite' && (
        <>
          <div>{t.triggers.operator_colon} <span className="font-medium text-status-error">{config.operator || 'all'}</span></div>
          {config.window_seconds && <div>{t.triggers.window_colon} {config.window_seconds}s</div>}
          {config.conditions && config.conditions.length > 0 && (
            <div className="space-y-0.5 mt-1">
              {config.conditions.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="text-status-error typo-code">{i + 1}.</span>
                  <code className="inline-flex items-center typo-code">{c.event_type}</code>
                  {c.source_filter && <span className="text-ink-1">from {c.source_filter}</span>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
