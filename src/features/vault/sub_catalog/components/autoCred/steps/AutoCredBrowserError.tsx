import type { BrowserLogEntry, AutoCredErrorInfo } from '../helpers/types';
import { CopyLogButton } from '../display/AutoCredLogEntries';
import { ERROR_KIND_CONFIG, useAutoScrollRef } from '../helpers/autoCredErrorConfig';
import { useTranslation } from '@/i18n/useTranslation';

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
      className="animate-fade-slide-in space-y-4"
    >
      {/* Error banner */}
      <div className="flex items-start gap-3 p-3 rounded-modal border border-red-500/20 bg-red-500/5">
        <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{t.vault.auto_cred.browser_error_title}</p>
            <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full border ${config!.badgeClass}`}>
              {config!.label}
            </span>
          </div>
          <p className="text-sm text-foreground/70 mt-1">{error.guidance}</p>
        </div>
      </div>

      {/* Persistent terminal log */}
      <div
        ref={scrollRef}
        className="max-h-[26rem] overflow-y-auto rounded-modal border border-primary/10 bg-black/30 p-3 font-mono text-sm space-y-1"
      >
        {logs.map((entry, i) => (
          <div key={i} className={`flex items-start gap-2 ${
            entry.type === 'error' ? 'text-red-400' :
            entry.type === 'warning' ? 'text-amber-400' :
            entry.type === 'action' ? 'text-cyan-400' :
            'text-muted-foreground/70'
          }`}>
            <span className="text-muted-foreground/60 select-none shrink-0">
              {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span>{entry.message}</span>
          </div>
        ))}
        {logs.length === 0 && (
          <div className="text-muted-foreground/60 text-center py-8">{t.vault.auto_cred_extra.no_log_output}</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <CopyLogButton logs={logs} />
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-modal hover:bg-secondary/40 transition-colors"
          >
            Set Up Manually
          </button>
          {error.retryable && (
            <button
              onClick={onRetry}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-modal text-sm font-medium transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
