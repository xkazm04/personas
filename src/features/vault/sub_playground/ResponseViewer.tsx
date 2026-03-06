import { useState, useMemo } from 'react';
import { Clock, Copy, Check } from 'lucide-react';
import type { ApiProxyResponse } from '@/api/apiProxy';

// ── Status styling ───────────────────────────────────────────────

function statusStyle(status: number): string {
  if (status >= 200 && status < 300) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25';
  if (status >= 300 && status < 400) return 'bg-amber-500/15 text-amber-400 border-amber-500/25';
  return 'bg-red-500/15 text-red-400 border-red-500/25';
}

// ── Component ────────────────────────────────────────────────────

type ResponseSubTab = 'body' | 'headers' | 'raw';

interface ResponseViewerProps {
  response: ApiProxyResponse;
}

export function ResponseViewer({ response }: ResponseViewerProps) {
  const [subTab, setSubTab] = useState<ResponseSubTab>('body');
  const [copied, setCopied] = useState(false);

  const prettyBody = useMemo(() => {
    if (!response.body) return '';
    // Always try JSON-formatting first — many APIs return JSON without proper content-type,
    // and some URLs (e.g. /user.json) return JSON with non-json content-type headers.
    try {
      const parsed = JSON.parse(response.body);
      return JSON.stringify(parsed, null, 2);
    } catch {
      // intentional: non-critical — JSON parse fallback
      return response.body;
    }
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
        <span className="flex items-center gap-1 text-sm text-muted-foreground/40">
          <Clock className="w-3 h-3" />
          {response.duration_ms}ms
        </span>
        {response.content_type && (
          <span className="text-sm text-muted-foreground/30">{response.content_type}</span>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 border-b border-primary/8">
        {(['body', 'headers', 'raw'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-3 py-1.5 text-sm font-medium capitalize transition-colors border-b-2 ${
              subTab === tab
                ? 'text-foreground/80 border-primary/50'
                : 'text-muted-foreground/40 border-transparent hover:text-muted-foreground/60'
            }`}
          >
            {tab}
            {tab === 'headers' && ` (${headerEntries.length})`}
          </button>
        ))}
        <div className="flex-1" />
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 px-2 py-1 rounded text-sm text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-secondary/30 transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {/* Content */}
      {subTab === 'body' && (
        <pre className="text-sm font-mono text-foreground/75 bg-secondary/15 rounded-lg border border-primary/8 p-3 overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
          {prettyBody || '(empty response)'}
        </pre>
      )}

      {subTab === 'headers' && (
        <div className="rounded-lg border border-primary/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-secondary/30 border-b border-primary/8">
                <th className="px-3 py-2 text-left font-semibold text-foreground/60 w-1/3">Header</th>
                <th className="px-3 py-2 text-left font-semibold text-foreground/60">Value</th>
              </tr>
            </thead>
            <tbody>
              {headerEntries.map(([key, val], i) => (
                <tr
                  key={key}
                  className={`border-b border-primary/5 ${i % 2 === 0 ? '' : 'bg-secondary/10'}`}
                >
                  <td className="px-3 py-1.5 font-mono text-violet-400/70">{key}</td>
                  <td className="px-3 py-1.5 text-foreground/70 break-all">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {subTab === 'raw' && (
        <pre className="text-sm font-mono text-muted-foreground/50 bg-secondary/15 rounded-lg border border-primary/8 p-3 overflow-auto max-h-[400px] whitespace-pre-wrap break-words">
          {response.body || '(empty response)'}
        </pre>
      )}
    </div>
  );
}
