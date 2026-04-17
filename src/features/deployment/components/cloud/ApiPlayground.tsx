import { useState, useCallback, useRef } from 'react';
import { Send, Copy, Check, ChevronDown, ChevronRight, Terminal, Code2, Loader2 } from 'lucide-react';
import { executePersona } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiPlaygroundProps {
  slug: string;
  personaId: string;
  endpointUrl: string;
}

type SnippetLang = 'curl' | 'fetch';

interface PlaygroundResponse {
  status: 'success' | 'error';
  data: string | null;
  error: string | null;
  durationMs: number | null;
  costUsd: number;
  model: string | null;
}

// ---------------------------------------------------------------------------
// Snippet generators
// ---------------------------------------------------------------------------

function buildCurlSnippet(endpointUrl: string, body: string): string {
  const escaped = body.replace(/'/g, "'\\''");
  return `curl -X POST '${endpointUrl}' \\
  -H 'Content-Type: application/json' \\
  -d '${escaped}'`;
}

function buildFetchSnippet(endpointUrl: string, body: string): string {
  return `const response = await fetch('${endpointUrl}', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(${body}),
});
const data = await response.json();
console.log(data);`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const DEFAULT_BODY = JSON.stringify({ message: 'Hello! Please confirm you are operational.' }, null, 2);

export function ApiPlayground({ slug: _slug, personaId, endpointUrl }: ApiPlaygroundProps) {
  const { t } = useTranslation();
  const dt = t.deployment.api_playground;
  const [expanded, setExpanded] = useState(false);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const [snippetLang, setSnippetLang] = useState<SnippetLang>('curl');
  const [copiedSnippet, setCopiedSnippet] = useState(false);
  const [showSnippets, setShowSnippets] = useState(false);
  const abortRef = useRef(false);

  const handleSend = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setResponse(null);
    abortRef.current = false;

    let inputData: string;
    try {
      // Validate JSON, then extract the message field or use the whole body
      const parsed = JSON.parse(body);
      inputData = typeof parsed.message === 'string' ? parsed.message : body;
    } catch {
      inputData = body;
    }

    try {
      const exec = await executePersona(personaId, undefined, inputData);
      if (abortRef.current) return;

      setResponse({
        status: exec.status === 'completed' ? 'success' : 'error',
        data: exec.output_data,
        error: exec.error_message,
        durationMs: exec.duration_ms,
        costUsd: exec.cost_usd,
        model: exec.model_used,
      });
    } catch (err) {
      if (abortRef.current) return;
      setResponse({
        status: 'error',
        data: null,
        error: err instanceof Error ? err.message : String(err),
        durationMs: null,
        costUsd: 0,
        model: null,
      });
    } finally {
      setSending(false);
    }
  }, [body, personaId, sending]);

  const snippet = snippetLang === 'curl'
    ? buildCurlSnippet(endpointUrl, body)
    : buildFetchSnippet(endpointUrl, body);

  const copySnippet = useCallback(() => {
    navigator.clipboard.writeText(snippet);
    setCopiedSnippet(true);
    setTimeout(() => setCopiedSnippet(false), 2000);
  }, [snippet]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="flex items-center gap-1.5 text-xs text-foreground hover:text-indigo-400
                   transition-colors cursor-pointer py-0.5"
      >
        <Terminal className="w-3 h-3" />
        <span>{dt.title}</span>
        <ChevronRight className="w-3 h-3" />
      </button>
    );
  }

  return (
    <div className="space-y-2 border border-indigo-500/20 rounded-card bg-indigo-500/5 p-2.5">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(false)}
        className="flex items-center gap-1.5 text-xs font-medium text-indigo-400
                   hover:text-indigo-300 transition-colors cursor-pointer"
      >
        <Terminal className="w-3 h-3" />
        <span>{dt.title}</span>
        <ChevronDown className="w-3 h-3" />
      </button>

      {/* Request body editor */}
      <div className="space-y-1">
        <label className="text-[11px] font-medium text-foreground uppercase tracking-wider">
          {dt.request_body}
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full px-2.5 py-2 text-xs font-mono rounded-card
                     bg-secondary/50 border border-primary/10
                     text-foreground/90 placeholder:text-foreground
                     focus-visible:outline-none focus-visible:border-indigo-500/40
                     resize-y transition-colors"
          placeholder='{ "message": "Your prompt here..." }'
        />
      </div>

      {/* Send button */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSend}
          disabled={sending || !body.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-card
                     bg-indigo-500/15 border border-indigo-500/25 text-indigo-400
                     hover:bg-indigo-500/25 hover:text-indigo-300
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-colors cursor-pointer"
        >
          {sending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Send className="w-3 h-3" />}
          {sending ? dt.sending : dt.send_request}
        </button>

        <button
          type="button"
          onClick={() => setShowSnippets((p) => !p)}
          className="flex items-center gap-1 px-2 py-1.5 text-xs text-foreground
                     hover:text-foreground/80 rounded-card hover:bg-secondary/40
                     transition-colors cursor-pointer"
        >
          <Code2 className="w-3 h-3" />
          {dt.snippets}
        </button>
      </div>

      {/* Snippet panel */}
      {showSnippets && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1">
            {(['curl', 'fetch'] as const).map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => setSnippetLang(lang)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-input transition-colors cursor-pointer ${
                  snippetLang === lang
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    : 'text-foreground hover:text-muted-foreground/80 border border-transparent'
                }`}
              >
                {lang}
              </button>
            ))}
            <button
              type="button"
              onClick={copySnippet}
              className="ml-auto flex items-center gap-1 px-1.5 py-0.5 text-[11px] rounded-input
                         text-foreground hover:text-foreground/80
                         hover:bg-secondary/40 transition-colors cursor-pointer"
            >
              {copiedSnippet
                ? <><Check className="w-3 h-3 text-emerald-400" /> Copied</>
                : <><Copy className="w-3 h-3" /> Copy</>}
            </button>
          </div>
          <pre className="text-[11px] font-mono bg-secondary/50 border border-primary/10 rounded-card
                         p-2.5 overflow-x-auto text-foreground whitespace-pre-wrap break-all">
            {snippet}
          </pre>
        </div>
      )}

      {/* Response viewer */}
      {response && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span className="font-medium text-foreground uppercase tracking-wider">{dt.response_label}</span>
            <span className={`px-1.5 py-0.5 rounded font-medium ${
              response.status === 'success'
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            }`}>
              {response.status === 'success' ? '200 OK' : 'ERROR'}
            </span>
            {response.durationMs != null && (
              <span className="text-foreground">
                {response.durationMs < 1000
                  ? `${response.durationMs}ms`
                  : `${(response.durationMs / 1000).toFixed(1)}s`}
              </span>
            )}
            {response.costUsd > 0 && (
              <span className="text-foreground">
                ${response.costUsd.toFixed(4)}
              </span>
            )}
            {response.model && (
              <span className="text-foreground">{response.model}</span>
            )}
          </div>
          <pre className={`typo-code font-mono rounded-card p-2.5 overflow-x-auto whitespace-pre-wrap break-words
                          border max-h-64 overflow-y-auto ${
            response.status === 'success'
              ? 'bg-emerald-500/5 border-emerald-500/15 text-foreground/85'
              : 'bg-red-500/5 border-red-500/15 text-red-400/90'
          }`}>
            {response.error
              ? response.error
              : response.data
                ? formatResponseData(response.data)
                : dt.empty_response}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatResponseData(data: string): string {
  try {
    return JSON.stringify(JSON.parse(data), null, 2);
  } catch {
    return data;
  }
}
