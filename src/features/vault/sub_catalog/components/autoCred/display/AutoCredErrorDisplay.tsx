import { useState } from 'react';
import { Clock, Globe, ChevronDown, ChevronUp, Wrench, AlertTriangle } from 'lucide-react';
import type { BrowserLogEntry, AutoCredErrorInfo } from '../helpers/types';
import { CopyLogButton } from './AutoCredLogEntries';
import { ERROR_KIND_CONFIG } from '../helpers/autoCredErrorConfig';
import { useTranslation } from '@/i18n/useTranslation';

interface AutoCredErrorDisplayProps {
  error: AutoCredErrorInfo;
  logs: BrowserLogEntry[];
  onRetry: () => void;
  onCancel: () => void;
}

export function AutoCredErrorDisplay({
  error,
  logs,
  onRetry,
  onCancel,
}: AutoCredErrorDisplayProps) {
  const { t } = useTranslation();
  const [contextOpen, setContextOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const config = ERROR_KIND_CONFIG[error.kind] ?? ERROR_KIND_CONFIG.cli_error!;
  const Icon = config!.icon;
  const ctx = error.context;

  return (
    <div
      key="error"
      className="animate-fade-slide-in space-y-4"
    >
      {/* Error header */}
      <div className="flex items-start gap-3 p-4 rounded-modal border border-red-500/15 bg-red-500/5">
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="typo-heading font-semibold text-foreground">{t.vault.auto_cred.browser_error_title}</p>
            <span className={`typo-body font-medium px-1.5 py-0.5 rounded-full border ${config!.badgeClass}`}>
              {config!.label}
            </span>
          </div>
          <p className="typo-body text-foreground mt-1">
            {error.guidance}
          </p>
        </div>
      </div>

      {/* What happened -- expandable context */}
      {ctx && (ctx.tool_call_count > 0 || ctx.last_url || ctx.duration_secs) && (
        <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 typo-body font-medium text-foreground hover:text-muted-foreground/90 transition-colors"
          >
            <span>{t.vault.auto_cred.what_happened}</span>
            {contextOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {contextOpen && (
            <div className="px-4 pb-3 space-y-2 typo-body text-foreground">
              {ctx.duration_secs != null && (
                <div className="flex items-center gap-2">
                  <Clock className="w-3 h-3 shrink-0" />
                  <span>Session ran for {ctx.duration_secs.toFixed(1)}s</span>
                </div>
              )}
              {ctx.tool_call_count > 0 && (
                <div className="flex items-center gap-2">
                  <Wrench className="w-3 h-3 shrink-0" />
                  <span>{ctx.tool_call_count} browser action{ctx.tool_call_count !== 1 ? 's' : ''} performed</span>
                </div>
              )}
              {ctx.last_url && (
                <div className="flex items-center gap-2">
                  <Globe className="w-3 h-3 shrink-0" />
                  <span className="truncate">Last URL: {ctx.last_url}</span>
                </div>
              )}
              {ctx.had_waiting_prompt && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 shrink-0 text-amber-400/70" />
                  <span>{t.vault.auto_cred.captcha_encountered}</span>
                </div>
              )}
              {ctx.last_actions.length > 0 && (
                <div className="mt-1 pt-1 border-t border-primary/8">
                  <p className="text-foreground mb-1">{t.vault.auto_cred.last_actions}</p>
                  <ul className="space-y-0.5 pl-4">
                    {ctx.last_actions.map((action, i) => (
                      <li key={i} className="list-disc text-foreground">{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Session log -- expandable with copy */}
      {logs.length > 0 && (
        <div className="rounded-card border border-primary/10 bg-secondary/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 typo-body font-medium text-foreground hover:text-muted-foreground/90 transition-colors"
          >
            <span>Session log ({logs.length} entries)</span>
            {logOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {logOpen && (
            <div className="border-t border-primary/10">
              <div className="max-h-[26rem] overflow-y-auto p-3 font-mono typo-code space-y-1">
                {logs.map((entry, i) => (
                  <div key={i} className={`flex items-start gap-2 ${
                    entry.type === 'error' ? 'text-red-400' :
                    entry.type === 'warning' ? 'text-amber-400' :
                    entry.type === 'action' ? 'text-cyan-400' :
                    'text-foreground'
                  }`}>
                    <span className="text-foreground select-none shrink-0">
                      {new Date(entry.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span>{entry.message}</span>
                  </div>
                ))}
              </div>
              <div className="px-3 pb-2">
                <CopyLogButton logs={logs} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 justify-center">
        <button
          onClick={onCancel}
          className="px-4 py-2 typo-body text-foreground hover:text-foreground rounded-modal hover:bg-secondary/40 transition-colors"
        >
          {error.retryable ? 'Cancel' : 'Set Up Manually'}
        </button>
        {error.retryable && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-modal typo-body font-medium transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
}
