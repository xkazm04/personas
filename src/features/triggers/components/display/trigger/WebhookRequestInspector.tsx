import { useState, useEffect, useCallback } from 'react';
import {
  Radio, ChevronDown, ChevronRight, Loader2, AlertTriangle,
  RefreshCw, RotateCcw, Terminal, Trash2, CheckCircle2, XCircle,
  Clock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WebhookRequestLog } from '@/lib/bindings/WebhookRequestLog';
import {
  listWebhookRequestLogs,
  clearWebhookRequestLogs,
  replayWebhookRequest,
  webhookRequestToCurl,
} from '@/api/pipeline/triggers';

// --- Helpers ---------------------------------------------------------------

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-emerald-400';
  if (code >= 400 && code < 500) return 'text-amber-400';
  return 'text-red-400';
}

function statusBg(code: number): string {
  if (code >= 200 && code < 300) return 'bg-emerald-500/10 border-emerald-500/15';
  if (code >= 400 && code < 500) return 'bg-amber-500/10 border-amber-500/15';
  return 'bg-red-500/10 border-red-500/15';
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60_000) return `${Math.floor(diffMs / 1000)}s ago`;
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
    if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

function JsonBlock({ label, data }: { label: string; data: string | null }) {
  if (!data) return null;
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    formatted = data;
  }
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium text-muted-foreground/60 uppercase tracking-wide">{label}</div>
      <pre className="px-2.5 py-2 rounded-lg bg-background/40 border border-primary/5 text-xs font-mono text-foreground/80 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
        {formatted}
      </pre>
    </div>
  );
}

// --- Request Row -----------------------------------------------------------

interface RequestRowProps {
  entry: WebhookRequestLog;
  isExpanded: boolean;
  onToggle: () => void;
  onReplay: () => void;
  onCopyCurl: () => void;
  isReplaying: boolean;
  replayResult: { success: boolean; message: string } | null;
  copiedCurl: boolean;
}

function RequestRow({ entry, isExpanded, onToggle, onReplay, onCopyCurl, isReplaying, replayResult, copiedCurl }: RequestRowProps) {
  return (
    <div className="rounded-xl bg-background/30 border border-primary/5 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm hover:bg-secondary/20 transition-colors"
      >
        {isExpanded
          ? <ChevronDown className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-muted-foreground/50 flex-shrink-0" />}
        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold border ${statusBg(entry.statusCode)} ${statusColor(entry.statusCode)}`}>
          {entry.statusCode}
        </span>
        <span className="text-xs font-mono text-muted-foreground/70">{entry.method}</span>
        {entry.eventId && (
          <span className="text-xs text-emerald-400/70 font-mono truncate max-w-[120px]" title={entry.eventId}>
            {entry.eventId.slice(0, 8)}...
          </span>
        )}
        {entry.errorMessage && (
          <span className="text-xs text-red-400/80 truncate max-w-[180px]" title={entry.errorMessage}>
            {entry.errorMessage}
          </span>
        )}
        <span className="text-muted-foreground/50 ml-auto text-xs flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {formatTime(entry.receivedAt)}
        </span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 space-y-2 border-t border-primary/5">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground/60">
                <span className="font-mono">{entry.id.slice(0, 12)}</span>
                <span>{new Date(entry.receivedAt).toLocaleString()}</span>
              </div>

              <JsonBlock label="Headers" data={entry.headers} />
              <JsonBlock label="Body" data={entry.body} />

              {entry.errorMessage && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-red-400/70 uppercase tracking-wide">Error</div>
                  <div className="px-2.5 py-2 rounded-lg bg-red-500/5 border border-red-500/10 text-xs text-red-400/90 font-mono whitespace-pre-wrap break-all">
                    {entry.errorMessage}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <button
                  onClick={(e) => { e.stopPropagation(); onReplay(); }}
                  disabled={isReplaying}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-cyan-400/80 hover:text-cyan-400 hover:bg-cyan-500/10 rounded-lg border border-cyan-500/15 transition-colors disabled:opacity-40"
                  title="Re-send this payload to trigger a new execution"
                >
                  {isReplaying ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}
                  {isReplaying ? 'Replaying...' : 'Replay'}
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onCopyCurl(); }}
                  className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                    copiedCurl
                      ? 'text-emerald-400 border-emerald-500/15 bg-emerald-500/10'
                      : 'text-muted-foreground/80 hover:text-foreground border-primary/10 hover:bg-secondary/20'
                  }`}
                  title="Copy as cURL command"
                >
                  {copiedCurl ? <CheckCircle2 className="w-3 h-3" /> : <Terminal className="w-3 h-3" />}
                  {copiedCurl ? 'Copied!' : 'Copy as cURL'}
                </button>
                {replayResult && (
                  <span className={`flex items-center gap-1 text-xs ${replayResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                    {replayResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {replayResult.message}
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Main Component --------------------------------------------------------

interface WebhookRequestInspectorProps {
  triggerId: string;
}

export function WebhookRequestInspector({ triggerId }: WebhookRequestInspectorProps) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<WebhookRequestLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [copiedCurlId, setCopiedCurlId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await listWebhookRequestLogs(triggerId);
      setLogs(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [triggerId]);

  useEffect(() => {
    if (open && logs.length === 0 && !loading) {
      void fetch();
    }
  }, [open]);

  const handleReplay = async (logId: string) => {
    setReplayingId(logId);
    setReplayResult(null);
    try {
      const eventId = await replayWebhookRequest(logId);
      setReplayResult({ id: logId, success: true, message: `Event ${eventId.slice(0, 8)}...` });
      void fetch();
    } catch (e) {
      setReplayResult({ id: logId, success: false, message: e instanceof Error ? e.message : 'Replay failed' });
    } finally {
      setReplayingId(null);
    }
  };

  const handleCopyCurl = async (logId: string) => {
    try {
      const curl = await webhookRequestToCurl(logId);
      await navigator.clipboard.writeText(curl);
      setCopiedCurlId(logId);
      setTimeout(() => setCopiedCurlId(null), 2000);
    } catch {
      // best-effort
    }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearWebhookRequestLogs(triggerId);
      setLogs([]);
    } catch {
      // best-effort
    } finally {
      setClearing(false);
    }
  };

  const errorCount = logs.filter(l => l.statusCode >= 400).length;

  return (
    <>
      <button
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1.5 pt-1 border-t border-primary/5 text-sm text-muted-foreground/80 hover:text-muted-foreground transition-colors w-full"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Radio className="w-3 h-3" />
        Request inspector
        {logs.length > 0 && (
          <span className="text-muted-foreground/50 ml-1">({logs.length})</span>
        )}
        {errorCount > 0 && (
          <span className="text-red-400/70 text-xs ml-1">{errorCount} errors</span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1.5 pt-1">
              {loading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground/80">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Loading...
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 py-2 text-sm text-amber-400/90">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  Could not load request log
                  <button
                    onClick={() => void fetch()}
                    className="ml-auto flex items-center gap-1 text-sm text-muted-foreground/80 hover:text-foreground transition-colors"
                  >
                    <RefreshCw className="w-3 h-3" />Retry
                  </button>
                </div>
              ) : logs.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground/80">
                  No webhook requests received yet
                </div>
              ) : (
                <>
                  {logs.map(entry => (
                    <RequestRow
                      key={entry.id}
                      entry={entry}
                      isExpanded={expandedId === entry.id}
                      onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                      onReplay={() => void handleReplay(entry.id)}
                      onCopyCurl={() => void handleCopyCurl(entry.id)}
                      isReplaying={replayingId === entry.id}
                      replayResult={replayResult?.id === entry.id ? replayResult : null}
                      copiedCurl={copiedCurlId === entry.id}
                    />
                  ))}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      onClick={() => void fetch()}
                      disabled={loading}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground/90 transition-colors"
                    >
                      <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
                      Refresh
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => void handleClear()}
                      disabled={clearing}
                      className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-red-400/60 hover:text-red-400/90 transition-colors"
                    >
                      {clearing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      Clear all
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
