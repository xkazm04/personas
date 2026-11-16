import { useState, useEffect, useCallback, useRef } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { useKeyedCopyFlag } from '@/hooks/utility/interaction/useKeyedCopyFlag';
import {
  Radio, ChevronDown, ChevronRight, AlertTriangle,
  RefreshCw, RotateCcw, Terminal, Trash2, CheckCircle2, XCircle,
  Clock,
} from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { JsonPayloadBlock } from './JsonPayloadBlock';
import type { WebhookRequestLog } from '@/lib/bindings/WebhookRequestLog';
import {
  listWebhookRequestLogs,
  clearWebhookRequestLogs,
  replayWebhookRequest,
  webhookRequestToCurl,
} from '@/api/pipeline/triggers';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { createLatestWins } from '@/stores/util/latestWins';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';


// --- Helpers ---------------------------------------------------------------

function statusColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-status-success';
  if (code >= 400 && code < 500) return 'text-status-warning';
  return 'text-status-error';
}

function statusBg(code: number): string {
  if (code >= 200 && code < 300) return 'bg-status-success/10 border-status-success/15';
  if (code >= 400 && code < 500) return 'bg-status-warning/10 border-status-warning/15';
  return 'bg-status-error/10 border-status-error/15';
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
  const { t } = useTranslation();
  return (
    <div className="rounded-modal bg-background/30 border border-hair overflow-hidden">
      <Button
        type="button"
        onClick={onToggle}
        variant="ghost"
        size="sm"
        className="w-full"
        icon={isExpanded
          ? <ChevronDown className="w-3 h-3 text-ink-1 flex-shrink-0" />
          : <ChevronRight className="w-3 h-3 text-ink-1 flex-shrink-0" />}
      >
        <span className={`px-1.5 py-0.5 rounded-interactive typo-caption border ${statusBg(entry.statusCode)} ${statusColor(entry.statusCode)}`}>
        {entry.statusCode}
        </span>
        <span className="typo-code text-ink-1">{entry.method}</span>
        {entry.eventId && (
        <Tooltip content={entry.eventId}><span className="typo-code text-status-success truncate max-w-[120px]">
        {entry.eventId.slice(0, 8)}...
        </span></Tooltip>
        )}
        {entry.errorMessage && (
        <Tooltip content={entry.errorMessage}><span className="typo-caption text-status-error truncate max-w-[180px]">
        {entry.errorMessage}
        </span></Tooltip>
        )}
        <span className="text-ink-2 ml-auto typo-caption flex items-center gap-1">
        <Clock className="w-3 h-3" />
        {formatTime(entry.receivedAt)}
        </span>
      </Button>

      {isExpanded && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="px-3 pb-2.5 pt-1 space-y-2 border-t border-hair">
              <div className="flex flex-wrap gap-x-4 gap-y-1 typo-caption text-ink-2">
                <span className="font-mono">{entry.id.slice(0, 12)}</span>
                <span>{<AbsoluteTime timestamp={entry.receivedAt} />}</span>
              </div>

              <JsonPayloadBlock label="Headers" data={entry.headers} />
              <JsonPayloadBlock label="Body" data={entry.body} />

              {entry.errorMessage && (
                <div className="space-y-1">
                  <div className="typo-label text-status-error">Error</div>
                  <div className="px-2.5 py-2 rounded-card bg-status-error/5 border border-status-error/10 typo-code text-status-error whitespace-pre-wrap break-all">
                    {entry.errorMessage}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-1 flex-wrap">
                <Button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onReplay(); }}
                  disabled={isReplaying}
                  tooltip={t.triggers.replay_label}
                  variant="secondary"
                  size="sm"
                  icon={isReplaying ? <LoadingSpinner size="xs" /> : <RotateCcw className="w-3 h-3" />}
                >{isReplaying ? t.triggers.replaying_label : t.triggers.replay_label}</Button>
                <CopyButton
                  copied={copiedCurl}
                  onCopy={() => { onCopyCurl(); }}
                  label="Copy as cURL"
                  copiedLabel="Copied!"
                  iconSize="w-3 h-3"
                  icon={<Terminal className="w-3 h-3" />}
                  className="px-2.5 py-1 typo-caption rounded-card border border-hair text-ink-1 hover:text-ink-1 hover:bg-surface-1"
                />
                {replayResult && (
                  <span className={`flex items-center gap-1 typo-caption ${replayResult.success ? 'text-status-success' : 'text-status-error'}`}>
                    {replayResult.success ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                    {replayResult.message}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  );
}

// --- Main Component --------------------------------------------------------

interface WebhookRequestInspectorProps {
  triggerId: string;
}

export function WebhookRequestInspector({ triggerId }: WebhookRequestInspectorProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<WebhookRequestLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayResult, setReplayResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const { copiedKey: copiedCurlId, copy } = useKeyedCopyFlag<string>();
  const [clearing, setClearing] = useState(false);

  // A slow read for the previous trigger must not land over the current one's.
  const [latestFetch] = useState(() => createLatestWins());
  const fetch = useCallback(async () => {
    const token = latestFetch.next();
    setLoading(true);
    setError(false);
    try {
      const result = await listWebhookRequestLogs(triggerId);
      if (!latestFetch.isCurrent(token)) return;
      setLogs(result);
    } catch {
      if (!latestFetch.isCurrent(token)) return;
      setError(true);
    } finally {
      if (latestFetch.isCurrent(token)) setLoading(false);
    }
  }, [triggerId, latestFetch]);

  // Fetch once per (open, trigger). Guarding on logs.length === 0 treated an
  // empty result as "never fetched", so a webhook with zero logs refetched in
  // an infinite IPC loop for as long as the section was open.
  const fetchedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && fetchedForRef.current !== triggerId) {
      fetchedForRef.current = triggerId;
      void fetch();
    }
  }, [open, triggerId, fetch]);

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
      copy(logId, curl);
    } catch (err) { silentCatch("features/triggers/sub_triggers/WebhookRequestInspector:catch1")(err); }
  };

  const handleClear = async () => {
    setClearing(true);
    try {
      await clearWebhookRequestLogs(triggerId);
      setLogs([]);
    } catch (err) { silentCatch("features/triggers/sub_triggers/WebhookRequestInspector:catch2")(err); } finally {
      setClearing(false);
    }
  };

  const errorCount = logs.filter(l => l.statusCode >= 400).length;

  return (
    <>
      <Button variant="ghost" size="xs" onClick={() => setOpen(v => !v)} className="w-full justify-start">
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Radio className="w-3 h-3" />
        {t.triggers.request_inspector}
        {logs.length > 0 && (
          <span className="text-ink-1 ml-1">({logs.length})</span>
        )}
        {errorCount > 0 && (
          <span className="text-status-error typo-caption ml-1">{errorCount} errors</span>
        )}
      </Button>

      {open && (
          <div
            className="animate-fade-slide-in overflow-hidden"
          >
            <div className="space-y-1.5 pt-1">
              {loading ? (
                <div className="flex items-center gap-2 py-2 typo-body text-ink-1">
                  <LoadingSpinner size="xs" />
                  {t.triggers.loading_history}
                </div>
              ) : error ? (
                <div className="flex items-center gap-2 py-2 typo-body text-status-warning">
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  {t.triggers.could_not_load_log}
                  <Button
                    type="button"
                    onClick={() => void fetch()}
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    icon={<RefreshCw className="w-3 h-3" />}
                  >Retry</Button>
                </div>
              ) : logs.length === 0 ? (
                <EmptyState art="link" size="sm" title={t.triggers.no_webhook_requests} />
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
                    <Button
                      type="button"
                      onClick={() => void fetch()}
                      disabled={loading}
                      variant="ghost"
                      size="sm"
                      icon={<RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />}
                    >Refresh</Button>
                    <div className="flex-1" />
                    <Button
                      type="button"
                      onClick={() => void handleClear()}
                      disabled={clearing}
                      variant="danger"
                      size="sm"
                      icon={clearing ? <LoadingSpinner size="xs" /> : <Trash2 className="w-3 h-3" />}
                    >{t.triggers.clear_all}</Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
    </>
  );
}
