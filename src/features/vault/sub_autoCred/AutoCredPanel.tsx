import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, Loader2, CheckCircle2, XCircle, AlertTriangle, Clock, Globe, ChevronDown, ChevronUp, Wrench, MessageSquare, Copy, Check } from 'lucide-react';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import type { AutoCredErrorInfo, AutoCredMode, BrowserLogEntry } from './types';
import { useAutoCredSession } from './useAutoCredSession';
import { tauriPlaywrightAdapter, tauriGuidedAdapter } from './TauriPlaywrightAdapter';
import { checkPlaywrightAvailable } from '@/api/autoCredBrowser';
import { AutoCredConsent } from './AutoCredConsent';
import { AutoCredBrowser } from './AutoCredBrowser';
import { AutoCredReview } from './AutoCredReview';

interface AutoCredPanelProps {
  designResult: CredentialDesignResult;
  onComplete: () => void;
  onCancel: () => void;
}

export function AutoCredPanel({ designResult, onComplete, onCancel }: AutoCredPanelProps) {
  const [mode, setMode] = useState<AutoCredMode>('playwright');
  const [modeChecked, setModeChecked] = useState(false);

  // Check Playwright availability on mount
  useEffect(() => {
    checkPlaywrightAvailable()
      .then((available) => {
        setMode(available ? 'playwright' : 'guided');
        setModeChecked(true);
      })
      .catch(() => {
        setMode('guided');
        setModeChecked(true);
      });
  }, []);

  const adapter = mode === 'guided' ? tauriGuidedAdapter : tauriPlaywrightAdapter;
  const session = useAutoCredSession({ adapter });
  const fieldsHash = useMemo(() => {
    return designResult.connector.fields
      .map((f) => `${f.key}:${f.type}:${f.required ? '1' : '0'}`)
      .join('|');
  }, [designResult.connector.fields]);

  // Initialize session when design result arrives and mode is resolved
  useEffect(() => {
    if (modeChecked) {
      session.init(designResult);
    }
  }, [designResult.connector.name, fieldsHash, modeChecked]);

  const handleCancel = () => {
    session.reset();
    onCancel();
  };

  return (
    <div className="space-y-4">
      {/* Badge */}
      <div className="flex items-center gap-2">
        {mode === 'guided' ? (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <MessageSquare className="w-3.5 h-3.5 text-violet-400" />
            <span className="text-sm font-medium text-violet-400">Guided Setup</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
            <Bot className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-sm font-medium text-cyan-400">Auto-Setup via Playwright MCP</span>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        {session.phase === 'consent' && (
          <AutoCredConsent
            key="consent"
            designResult={designResult}
            onConsent={session.startBrowser}
            onCancel={handleCancel}
            mode={mode}
          />
        )}

        {session.phase === 'browser' && (
          <AutoCredBrowser
            key="browser"
            logs={session.logs}
            onCancel={session.cancelBrowser}
            mode={mode}
          />
        )}

        {session.phase === 'browser-error' && session.error && (
          <AutoCredBrowserError
            key="browser-error"
            logs={session.logs}
            error={session.error}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
          />
        )}

        {session.phase === 'review' && (
          <AutoCredReview
            key="review"
            designResult={designResult}
            credentialName={session.credentialName}
            onCredentialNameChange={session.setCredentialName}
            extractedValues={session.extractedValues}
            onValueChange={session.updateValue}
            onHealthcheck={session.runHealthcheck}
            healthResult={session.healthResult}
            onSave={session.save}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
            isSaving={session.isSaving}
            isPartial={session.isPartial}
          />
        )}

        {session.phase === 'saving' && (
          <motion.div
            key="saving"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center justify-center py-12 gap-3"
          >
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-sm text-muted-foreground/90">Saving credential...</p>
          </motion.div>
        )}

        {session.phase === 'done' && (
          <motion.div
            key="done"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="flex flex-col items-center justify-center py-10 gap-4"
          >
            <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-foreground">Credential Saved</p>
              <p className="text-sm text-muted-foreground/70 mt-1">
                {designResult.connector.label} credential has been securely stored.
              </p>
            </div>
            <button
              onClick={onComplete}
              className="px-4 py-2 bg-primary/15 hover:bg-primary/25 text-primary rounded-xl text-sm font-medium transition-colors"
            >
              Done
            </button>
          </motion.div>
        )}

        {session.phase === 'error' && session.error && (
          <AutoCredErrorDisplay
            key="error"
            error={session.error}
            logs={session.logs}
            onRetry={session.startBrowser}
            onCancel={handleCancel}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Browser error with persistent terminal ──────────────────────

function AutoCredBrowserError({
  logs,
  error,
  onRetry,
  onCancel,
}: {
  logs: BrowserLogEntry[];
  error: AutoCredErrorInfo;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const scrollRef = useAutoScrollRef(logs.length);
  const config = ERROR_KIND_CONFIG[error.kind] ?? ERROR_KIND_CONFIG.cli_error!;
  const Icon = config!.icon;

  return (
    <motion.div
      key="browser-error"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-4"
    >
      {/* Error banner */}
      <div className="flex items-start gap-3 p-3 rounded-xl border border-red-500/20 bg-red-500/5">
        <div className="w-8 h-8 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Auto-Setup Failed</p>
            <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full border ${config!.badgeClass}`}>
              {config!.label}
            </span>
          </div>
          <p className="text-sm text-foreground/70 mt-1">{error.guidance}</p>
        </div>
      </div>

      {/* Persistent terminal log — 2x height */}
      <div
        ref={scrollRef}
        className="max-h-[26rem] overflow-y-auto rounded-xl border border-primary/10 bg-black/30 p-3 font-mono text-sm space-y-1"
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
          <div className="text-muted-foreground/60 text-center py-8">No log output captured.</div>
        )}
      </div>

      {/* Actions */}
      <div className="flex justify-between">
        <CopyLogButton logs={logs} />
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
          >
            Set Up Manually
          </button>
          {error.retryable && (
            <button
              onClick={onRetry}
              className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function useAutoScrollRef(dep: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [dep]);
  return ref;
}

// ── Copy log helper ─────────────────────────────────────────────

function CopyLogButton({ logs }: { logs: BrowserLogEntry[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (logs.length === 0) return;
    const text = logs
      .map((e) => {
        const time = new Date(e.ts).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        const prefix = e.type === 'error' ? '[ERROR]' : e.type === 'warning' ? '[WARN]' : e.type === 'url' ? '[URL]' : e.type === 'action' ? '[ACTION]' : '[INFO]';
        return `${time} ${prefix} ${e.message}`;
      })
      .join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(console.error);
  }, [logs]);

  if (logs.length === 0) return null;

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-muted-foreground/60 hover:text-muted-foreground rounded-lg hover:bg-secondary/30 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">Copied</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>Copy Log</span>
        </>
      )}
    </button>
  );
}

// ── Error kind display config ────────────────────────────────────

const ERROR_KIND_CONFIG: Record<string, { label: string; badgeClass: string; icon: typeof XCircle }> = {
  cli_not_found: { label: 'CLI Not Found', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  spawn_failed: { label: 'Spawn Failed', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: XCircle },
  timeout: { label: 'Timeout', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: Clock },
  env_conflict: { label: 'Env Conflict', badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/25', icon: AlertTriangle },
  cli_error: { label: 'CLI Error', badgeClass: 'bg-red-500/15 text-red-400 border-red-500/25', icon: Wrench },
  extraction_failed: { label: 'Extraction Failed', badgeClass: 'bg-amber-500/15 text-amber-400 border-amber-500/25', icon: AlertTriangle },
};

// ── Categorized error display ────────────────────────────────────

function AutoCredErrorDisplay({
  error,
  logs,
  onRetry,
  onCancel,
}: {
  error: AutoCredErrorInfo;
  logs: BrowserLogEntry[];
  onRetry: () => void;
  onCancel: () => void;
}) {
  const [contextOpen, setContextOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const config = ERROR_KIND_CONFIG[error.kind] ?? ERROR_KIND_CONFIG.cli_error!;
  const Icon = config!.icon;
  const ctx = error.context;

  return (
    <motion.div
      key="error"
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="space-y-4"
    >
      {/* Error header */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/15 bg-red-500/5">
        <div className="w-10 h-10 rounded-full bg-red-500/15 flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">Auto-Setup Failed</p>
            <span className={`text-sm font-medium px-1.5 py-0.5 rounded-full border ${config!.badgeClass}`}>
              {config!.label}
            </span>
          </div>
          <p className="text-sm text-foreground/70 mt-1">
            {error.guidance}
          </p>
        </div>
      </div>

      {/* What happened — expandable context */}
      {ctx && (ctx.tool_call_count > 0 || ctx.last_url || ctx.duration_secs) && (
        <div className="rounded-lg border border-primary/10 bg-secondary/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setContextOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground/70 hover:text-muted-foreground/90 transition-colors"
          >
            <span>What happened</span>
            {contextOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {contextOpen && (
            <div className="px-4 pb-3 space-y-2 text-sm text-muted-foreground/70">
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
                  <span>A login/CAPTCHA prompt was encountered</span>
                </div>
              )}
              {ctx.last_actions.length > 0 && (
                <div className="mt-1 pt-1 border-t border-primary/8">
                  <p className="text-muted-foreground/50 mb-1">Last actions:</p>
                  <ul className="space-y-0.5 pl-4">
                    {ctx.last_actions.map((action, i) => (
                      <li key={i} className="list-disc text-muted-foreground/60">{action}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Session log — expandable with copy */}
      {logs.length > 0 && (
        <div className="rounded-lg border border-primary/10 bg-secondary/15 overflow-hidden">
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground/70 hover:text-muted-foreground/90 transition-colors"
          >
            <span>Session log ({logs.length} entries)</span>
            {logOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          {logOpen && (
            <div className="border-t border-primary/10">
              <div className="max-h-[26rem] overflow-y-auto p-3 font-mono text-sm space-y-1">
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
          className="px-4 py-2 text-sm text-muted-foreground/70 hover:text-foreground rounded-xl hover:bg-secondary/40 transition-colors"
        >
          {error.retryable ? 'Cancel' : 'Set Up Manually'}
        </button>
        {error.retryable && (
          <button
            onClick={onRetry}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium transition-colors"
          >
            Retry
          </button>
        )}
      </div>
    </motion.div>
  );
}
