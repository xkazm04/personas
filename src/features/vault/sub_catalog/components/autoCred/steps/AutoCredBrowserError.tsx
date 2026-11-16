import type { BrowserLogEntry, AutoCredErrorInfo } from '../helpers/types';
import { CopyLogButton } from '../display/AutoCredLogEntries';
import { ERROR_KIND_CONFIG, useAutoScrollRef } from '../helpers/autoCredErrorConfig';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

interface AutoCredBrowserErrorProps {
  logs: BrowserLogEntry[];
  error: AutoCredErrorInfo;
  onRetry: () => void;
  onCancel: () => void;
}

export function AutoCredBrowserError({
  logs,
  error,
  onRetry,
  onCancel,
}: AutoCredBrowserErrorProps) {
  const { t } = useTranslation();
  const scrollRef = useAutoScrollRef(logs.length);
  const config = ERROR_KIND_CONFIG[error.kind] ?? ERROR_KIND_CONFIG.cli_error!;
  const Icon = config!.icon;

  return (
    <div
      key="browser-error"
      data-testid="vault-autocred-error"
      data-error-kind={error.kind}
      className="animate-fade-slide-in space-y-4"
    >
      {/* Error banner */}
      <div className="flex items-start gap-3 p-3 rounded-modal border border-status-error/20 bg-status-error/5">
        <div className="w-8 h-8 rounded-full bg-status-error/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-status-error" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="typo-heading text-foreground">{t.vault.auto_cred.browser_error_title}</p>
            <span className={`typo-body px-1.5 py-0.5 rounded-full border ${config!.badgeClass}`}>
              {t.vault.auto_cred_extra[config!.labelKey]}
            </span>
          </div>
          <p className="typo-body text-foreground mt-1">{error.guidance}</p>
        </div>
      </div>

      {/* Persistent terminal log */}
      <div
        ref={scrollRef}
        className="max-h-[26rem] overflow-y-auto rounded-modal border border-hair bg-black/30 p-3 typo-code space-y-1"
      >
        {logs.map((entry, i) => (
          <div key={i} className={`flex items-start gap-2 ${
            entry.type === 'error' ? 'text-status-error' :
            entry.type === 'warning' ? 'text-status-warning' :
            entry.type === 'action' ? 'text-role-highlight' :
            'text-foreground'
          }`}>
            <span className="text-foreground select-none shrink-0">
              {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span>{entry.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-foreground text-center py-8">{t.vault.auto_cred_extra.no_log_output}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <CopyLogButton logs={logs} />
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={onCancel}
            variant="ghost"
            size="md"
          >
            {t.vault.auto_cred.setup_manually}
          </Button>
          {error.retryable && (
            <Button
              type="button"
              onClick={onRetry}
              variant="accent"
              tone="highlight"
              size="md"
            >
              {t.vault.auto_cred.retry}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
