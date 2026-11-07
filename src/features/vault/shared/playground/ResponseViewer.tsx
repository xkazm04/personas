import { useTranslation } from '@/i18n/useTranslation';
import { useState, useMemo } from 'react';
import { Clock, Copy, Check } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { ApiProxyResponse } from '@/api/system/apiProxy';
import { prettyJson } from './prettyJson';
import Button from '@/features/shared/components/buttons/Button';

// -- Status styling -----------------------------------------------

function statusStyle(status: number): string {
  if (status >= 200 && status < 300) return 'bg-status-success/15 text-status-success border-status-success/25';
  if (status >= 300 && status < 400) return 'bg-status-warning/15 text-status-warning border-status-warning/25';
  return 'bg-status-error/15 text-status-error border-status-error/25';
}

// -- Component ----------------------------------------------------

type ResponseSubTab = 'body' | 'headers' | 'raw';

interface ResponseViewerProps {
  response: ApiProxyResponse;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const sh = t.vault.shared;
  const [subTab, setSubTab] = useState<ResponseSubTab>('body');
  const { copied, copy } = useCopyToClipboard(1500);

  const prettyBody = useMemo(() => {
    if (!response.body) return '';
    return prettyJson(response.body);
  }, [response.body]);

  const isJson = useMemo(() => {
    if (!response.body) return false;
    try { JSON.parse(response.body); return true; } catch { return false; }
  }, [response.body]);

  const headerEntries = useMemo(
    () => Object.entries(response.headers),
    [response.headers],
  );

  const handleCopy = () => {
    copy(subTab === 'headers' ? JSON.stringify(response.headers, null, 2) : response.body);
  };

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded-interactive typo-heading border ${statusStyle(response.status)}`}>
          {response.status} {response.status_text}
        </span>
        <span className="flex items-center gap-1 typo-body text-foreground">
          <Clock className="w-3 h-3" />
          {response.duration_ms}ms
        </span>
        {response.content_type && (
          <span className="typo-body text-foreground">{response.content_type}</span>
        )}
      </div>

      {/* Truncation warning */}
      {response.truncated && (
        <div className="px-3 py-2 rounded-card border border-status-warning/25 bg-status-warning/10 text-status-warning typo-body">
          {vt.truncated_warning}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-primary/8">
        {(['body', 'headers', 'raw'] as const).map((tab) => (
          <Button
            key={tab}
            onClick={() => setSubTab(tab)}
            variant={subTab === tab ? 'secondary' : 'ghost'}
            size="sm"
          >
            {tab}
            {tab === 'headers' && ` (${headerEntries.length})`}
          </Button>
        ))}
        <div className="flex-1" />
        <Button
          onClick={handleCopy}
          variant="ghost"
          size="xs"
          icon={copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
        >
          {copied ? sh.copied : t.common.copy}
        </Button>
      </div>

      {/* Content */}
      {subTab === 'body' && (
        prettyBody ? (
          isJson ? (
            <div className="rounded-card border border-primary/8 bg-secondary/15 p-3 overflow-auto max-h-[400px]">
              <MarkdownRenderer content={'```json\n' + prettyBody + '\n```'} />
            </div>
          ) : (
            // A non-JSON body is the remote service's text, shown as text. It
            // used to go through the markdown renderer, which rewrote it (`*`,
            // `_`, `#` became formatting) and turned an `![](url)` in the body
            // into an <img> the app fetched on render; the CSP admits
            // http://127.0.0.1:*, so a response could make the app GET its own
            // local listeners.
            <pre className="typo-code text-foreground bg-secondary/15 rounded-card border border-primary/8 p-3 overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
              {prettyBody}
            </pre>
          )
        ) : (
          <div className="typo-body text-foreground p-3">{t.vault.playground.response_empty}</div>
        )
      )}

      {subTab === 'headers' && (
        <div className="rounded-card border border-primary/8 overflow-hidden">
          <table className="w-full typo-body">
            <thead>
              <tr className="bg-surface-1 border-b border-primary/8">
                <th className="px-3 py-2 text-left w-1/3 typo-eyebrow text-foreground">{vt.header_col}</th>
                <th className="px-3 py-2 text-left typo-eyebrow text-foreground">{vt.value_col}</th>
              </tr>
            </thead>
            <tbody>
              {headerEntries.map(([key, val], i) => (
                <tr
                  key={key}
                  className={`border-b border-hair ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}
                >
                  <td className="px-3 py-1.5 font-mono text-role-agent/80">{key}</td>
                  <td className="px-3 py-1.5 text-foreground break-all">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'raw' && (
        <pre className="typo-code text-foreground bg-secondary/15 rounded-card border border-primary/8 p-3 overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
          {response.body || t.vault.playground.response_empty}
        </pre>
      )}
    </div>
  );
}
