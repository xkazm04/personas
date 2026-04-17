import { useTranslation } from '@/i18n/useTranslation';
import { useState, useMemo } from 'react';
import { Clock, Copy, Check } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import type { ApiProxyResponse } from '@/api/system/apiProxy';

// -- Status styling -----------------------------------------------

function statusStyle(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  if (status >= 300 && status < 400) return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return 'bg-red-500/15 text-red-400 border-red-500/25';
}

// -- Component ----------------------------------------------------

type ResponseSubTab = 'body' | 'headers' | 'raw';

interface ResponseViewerProps {
  response: ApiProxyResponse;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const [subTab, setSubTab] = useState<ResponseSubTab>('body');
  const [copied, setCopied] = useState(false);

  const prettyBody = useMemo(() => {
    if (!response.body) return '';
    try {
      const parsed = JSON.parse(response.body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // intentional: non-critical -- JSON parse fallback
      return response.body;
    }
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
    navigator.clipboard.writeText(subTab === 'headers' ? JSON.stringify(response.headers, null, 2) : response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center gap-3">
        <span className={`px-2.5 py-1 rounded text-sm font-bold border ${statusStyle(response.status)}`}>
          {response.status} {response.status_text}
        </span>
        <span className="flex items-center gap-1 text-sm text-foreground">
          <Clock className="w-3 h-3" />
          {response.duration_ms}ms
        </span>
        {response.content_type && (
          <span className="text-sm text-foreground">{response.content_type}</span>
        )}
      </div>

      {/* Truncation warning */}
      {response.truncated && (
        <div className="px-3 py-2 rounded-card border border-amber-500/25 bg-amber-500/10 text-amber-400 text-sm">
          {vt.truncated_warning}
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-primary/8">
        {(['body', 'headers', 'raw'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors border-b-2 ${
              subTab === tab
                ? 'text-foreground border-primary/50'
                : 'text-foreground border-transparent hover:text-muted-foreground/80'
            }`}
          >
            {tab}
            {tab === 'headers' && ` (${headerEntries.length})`}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-sm text-foreground hover:text-muted-foreground/80 hover:bg-secondary/30 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      {subTab === 'body' && (
        prettyBody ? (
          <div className="rounded-card border border-primary/8 bg-secondary/15 p-3 overflow-auto max-h-[400px]">
            <MarkdownRenderer content={isJson ? '```json\n' + prettyBody + '\n```' : prettyBody} />
          </div>
        ) : (
          <div className="text-sm text-foreground p-3">(empty response)</div>
        )
      )}

      {subTab === 'headers' && (
        <div className="rounded-card border border-primary/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/30 border-b border-primary/8">
                <th className="px-3 py-2 text-left font-semibold text-foreground w-1/3">{vt.header_col}</th>
                <th className="px-3 py-2 text-left font-semibold text-foreground">{vt.value_col}</th>
              </tr>
            </thead>
            <tbody>
              {headerEntries.map(([key, val], i) => (
                <tr
                  key={key}
                  className={`border-b border-primary/5 ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}
                >
                  <td className="px-3 py-1.5 font-mono text-violet-400/80">{key}</td>
                  <td className="px-3 py-1.5 text-foreground break-all">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'raw' && (
        <pre className="text-sm font-mono text-foreground bg-secondary/15 rounded-card border border-primary/8 p-3 overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
          {response.body || '(empty response)'}
        </pre>
      )}
    </div>
  );
}
