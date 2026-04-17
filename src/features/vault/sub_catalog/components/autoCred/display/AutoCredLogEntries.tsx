import { useState, useCallback } from 'react';
import {
  AlertTriangle, MousePointerClick, ExternalLink, Copy, Check,
} from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('auto-cred-log-entries');
import type { BrowserLogEntry } from '../helpers/types';
import { splitByUrls, formatLogsForCopy } from '../helpers/autoCredHelpers';
import { useTranslation } from '@/i18n/useTranslation';

// Re-export cards so existing imports from AutoCredBrowser still work
export { WaitingCard, InputRequestCard } from './AutoCredCards';

// -- Action block ---------------------------------------------------------

export function ActionBlock({
  entries,
  onUrlClick,
}: {
  entries: BrowserLogEntry[];
  onUrlClick: (url: string) => void;
}) {
  return (
    <div className="rounded-card bg-secondary/10 border border-primary/5 px-3 py-2 space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 text-sm text-foreground">
          <MousePointerClick className="w-3 h-3 mt-1 shrink-0 text-cyan-400/60" />
          <span className="leading-relaxed">
            <RichMessage message={entry.message} onUrlClick={onUrlClick} />
          </span>
        </div>
      ))}
    </div>
  );
}

// -- URL card -------------------------------------------------------------

export function UrlCard({
  entry,
  onUrlClick,
}: {
  entry: BrowserLogEntry;
  onUrlClick: (url: string) => void;
}) {
  const url = entry.url ?? '';
  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* ignore */ }

  return (
    <div className="flex items-center gap-3 p-2.5 rounded-card border border-blue-500/20 bg-blue-500/5">
      <ExternalLink className="w-4 h-4 text-blue-400 shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground">{entry.message.replace(/^Opening:\s*/, '')}</p>
        {hostname && <p className="text-sm text-foreground truncate">{hostname}</p>}
      </div>
      {url && (
        <button
          onClick={() => onUrlClick(url)}
          className="px-3 py-1 text-sm text-blue-400 hover:text-blue-300 rounded-card border border-blue-500/20 hover:bg-blue-500/10 transition-colors shrink-0"
        >
          Open
        </button>
      )}
    </div>
  );
}

// -- Error line -----------------------------------------------------------

export function ErrorLine({ entry }: { entry: BrowserLogEntry }) {
  return (
    <div className="flex items-start gap-2 text-sm text-red-400 px-1">
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      <span>{entry.message}</span>
    </div>
  );
}

// -- Rich message with clickable URLs -------------------------------------

export function RichMessage({
  message,
  onUrlClick,
}: {
  message: string;
  onUrlClick: (url: string) => void;
}) {
  const parts = splitByUrls(message);
  if (parts.length === 1 && !parts[0]!.isUrl) return <>{message}</>;

  return (
    <>
      {parts.map((part, i) =>
        part.isUrl ? (
          <button
            key={i}
            onClick={() => onUrlClick(part.text)}
            className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer transition-colors"
            title={`Open ${part.text} in browser`}
          >
            {part.text}
            <ExternalLink className="w-2.5 h-2.5 inline-block ml-0.5" />
          </button>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

// -- Copy log button ------------------------------------------------------

export function CopyLogButton({ logs }: { logs: BrowserLogEntry[] }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(formatLogsForCopy(logs)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((err) => { logger.error('Failed to copy log to clipboard', { error: String(err) }); });
  }, [logs]);

  if (logs.length === 0) return <div />;

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-foreground hover:text-muted-foreground rounded-card hover:bg-secondary/30 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-emerald-400" />
          <span className="text-emerald-400">{t.vault.auto_cred_extra.copied}</span>
        </>
      ) : (
        <>
          <Copy className="w-3.5 h-3.5" />
          <span>{t.vault.auto_cred_extra.copy_log}</span>
        </>
      )}
    </button>
  );
}
