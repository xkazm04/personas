import { useCallback } from 'react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import {
  AlertTriangle, MousePointerClick, ExternalLink, Copy, Check,
} from 'lucide-react';
import type { BrowserLogEntry } from '../helpers/types';
import { splitByUrls, formatLogsForCopy } from '../helpers/autoCredHelpers';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';


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
    <div className="rounded-card bg-secondary/10 border border-hair px-3 py-2 space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-start gap-2 typo-body text-foreground">
          <MousePointerClick className="w-3 h-3 mt-1 shrink-0 text-role-highlight/60" />
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
  const { t } = useTranslation();
  const safeUrl = sanitizeExternalUrl(entry.url);
  let hostname = '';
  if (safeUrl) {
    try { hostname = new URL(safeUrl).hostname; } catch (err) { silentCatch("features/vault/sub_catalog/components/autoCred/display/AutoCredLogEntries:catch1")(err); }
  }

  return (
    <div data-testid="vault-autocred-url" data-url={safeUrl ?? ''} className="flex items-center gap-3 p-2.5 rounded-card border border-status-info/20 bg-status-info/5">
      <ExternalLink className="w-4 h-4 text-status-info shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="typo-body text-foreground">{entry.message.replace(/^Opening:\s*/, '')}</p>
        {hostname && <p className="typo-body text-foreground truncate">{hostname}</p>}
      </div>
      {safeUrl && (
        <button
          type="button"
          onClick={() => onUrlClick(safeUrl)}
          className="px-3 py-1 typo-body text-status-info hover:text-status-info rounded-card border border-status-info/20 hover:bg-status-info/10 transition-colors shrink-0"
        >
          {t.vault.auto_cred_extra.open_url}
        </button>
      )}
    </div>
  );
}

// -- Error line -----------------------------------------------------------

export function ErrorLine({ entry }: { entry: BrowserLogEntry }) {
  return (
    <div className="flex items-start gap-2 typo-body text-status-error px-1">
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
  const { t, tx } = useTranslation();
  const parts = splitByUrls(message);
  if (parts.length === 1 && !parts[0]!.isUrl) return <>{message}</>;

  return (
    <>
      {parts.map((part, i) => {
        if (!part.isUrl) return <span key={i}>{part.text}</span>;
        const safe = sanitizeExternalUrl(part.text);
        if (!safe) return <span key={i}>{part.text}</span>;
        return (
          <button
            type="button"
            key={i}
            onClick={() => onUrlClick(safe)}
            className="text-status-info hover:text-status-info hover:underline cursor-pointer transition-colors"
            title={tx(t.vault.auto_cred_extra.open_url_title, { url: safe })}
          >
            {part.text}
            <ExternalLink className="w-2.5 h-2.5 inline-block ml-0.5" />
          </button>
        );
      })}
    </>
  );
}

// -- Copy log button ------------------------------------------------------

export function CopyLogButton({ logs }: { logs: BrowserLogEntry[] }) {
  const { t } = useTranslation();
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = useCallback(() => {
    if (logs.length === 0) return;
    copy(formatLogsForCopy(logs));
  }, [logs, copy]);

  if (logs.length === 0) return <div />;

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 typo-body text-foreground hover:text-ink-2 rounded-card hover:bg-surface-1 transition-colors"
    >
      {copied ? (
        <>
          <Check className="w-3.5 h-3.5 text-status-success" />
          <span className="text-status-success">{t.vault.auto_cred_extra.copied}</span>
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
