import { useState, useCallback, useRef, useEffect, useId } from 'react';
import { Send, Copy, Check, ChevronDown, ChevronRight, Terminal, Code2, Loader2 } from 'lucide-react';
import { useCopyToClipboard } from '@/hooks/utility/interaction/useCopyToClipboard';
import { executePersona } from '@/api/agents/executions';
import { useTranslation } from '@/i18n/useTranslation';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { awaitExecutionResult } from '../../hooks/awaitExecutionResult';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';

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
  /** `null` when the run's cost was never recorded — not the same as free. */
  costUsd: number | null;
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
  const bodyFieldId = useId();
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<PlaygroundResponse | null>(null);
  const [snippetLang, setSnippetLang] = useState<SnippetLang>('curl');
  const { copied: copiedSnippet, copy: copySnippetText } = useCopyToClipboard();
  const [showSnippets, setShowSnippets] = useState(false);
  const abortRef = useRef(false);
  // The wait below can outlive the card (collapse, tab switch, undeploy);
  // an unmounted playground stops polling and writes nothing.
  useEffect(() => {
    abortRef.current = false;
    return () => { abortRef.current = true; };
  }, []);

  const handleSend = useCallback(async () => {
    if (sending) return;
    setSending(true);
    setResponse(null);

    let inputData: string;
    try {
      // Validate JSON, then extract the message field or use the whole body
      const parsed = JSON.parse(body);
      inputData = typeof parsed.message === 'string' ? parsed.message : body;
    } catch {
      inputData = body;
    }

    try {
      const started = await executePersona(personaId, undefined, inputData);
      // `execute_persona` hands back the queued row; the output, duration and
      // cost exist only once the run lands.
      const exec = await awaitExecutionResult(started, personaId, { isCancelled: () => abortRef.current });
      if (abortRef.current) return;

      setResponse(exec
        ? {
            status: exec.status === 'completed' ? 'success' : 'error',
            data: exec.output_data,
            error: exec.error_message,
            durationMs: exec.duration_ms,
            costUsd: exec.cost_usd,
            model: exec.model_used,
          }
        : {
            status: 'error',
            data: null,
            error: t.errors.stream_timeout,
            durationMs: null,
            costUsd: null,
            model: null,
          });
    } catch (err) {
      silentCatch('features/agents/sub_deployment/ApiPlayground:send')(err);
      if (abortRef.current) return;
      setResponse({
        status: 'error',
        data: null,
        error: extractMessage(err),
        durationMs: null,
        // Never recorded (the call threw), not free - see PlaygroundResponse.
        costUsd: null,
        model: null,
      });
    } finally {
      setSending(false);
    }
  }, [body, personaId, sending, t]);

  const snippet = snippetLang === 'curl'
    ? buildCurlSnippet(endpointUrl, body)
    : buildFetchSnippet(endpointUrl, body);

  const copySnippet = useCallback(() => {
    copySnippetText(snippet);
  }, [snippet, copySnippetText]);

  if (!expanded) {
    return (
      <Button
        type="button"
        onClick={() => setExpanded(true)}
        aria-expanded={false}
        variant="ghost"
        size="xs"
        icon={<Terminal className="w-3 h-3" />}
      >
        <span>{dt.title}</span>
        <ChevronRight className="w-3 h-3" />
      </Button>
    );
  }

  return (
    <div className="space-y-2 border border-role-agent/20 rounded-card bg-role-agent/5 p-2.5">
      {/* Header */}
      <Button
        type="button"
        onClick={() => setExpanded(false)}
        aria-expanded
        variant="ghost"
        size="sm"
        icon={<Terminal className="w-3 h-3" />}
      >
        <span>{dt.title}</span>
        <ChevronDown className="w-3 h-3" />
      </Button>

      {/* Request body editor */}
      <div className="space-y-1">
        <label htmlFor={bodyFieldId} className="typo-eyebrow text-ink-1">
          {dt.request_body}
        </label>
        <textarea
          id={bodyFieldId}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          spellCheck={false}
          className="w-full px-2.5 py-2 typo-caption font-mono rounded-card
                     bg-surface-2 border border-hair
                     text-ink-1 placeholder:text-ink-3
                     focus-visible:outline-none focus-visible:border-role-agent/40
                     resize-y transition-colors"
          placeholder={dt.request_body_placeholder}
        />
      </div>

      {/* Send button */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={handleSend}
          disabled={sending || !body.trim()}
          variant="accent"
          tone="agent"
          size="sm"
          icon={sending
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <Send className="w-3 h-3" />}
        >{sending ? dt.sending : dt.send_request}</Button>

        <Button
          type="button"
          onClick={() => setShowSnippets((p) => !p)}
          variant="ghost"
          size="sm"
          icon={<Code2 className="w-3 h-3" />}
        >{dt.snippets}</Button>
      </div>

      {/* Snippet panel */}
      {showSnippets && (
        <div className="space-y-1.5">
          <p className="typo-caption text-ink-2">{dt.snippets_target_endpoint}</p>
          <div className="flex items-center gap-1">
            {(['curl', 'fetch'] as const).map((lang) => (
              <Button
                key={lang}
                type="button"
                onClick={() => setSnippetLang(lang)}
                variant={snippetLang === lang ? 'secondary' : 'ghost'}
                size="xs"
              >{lang}</Button>
            ))}
            <Button type="button" onClick={copySnippet} variant="ghost" size="xs" className="ml-auto">
              {copiedSnippet
              ? <><Check className="w-3 h-3 text-status-success" /> {t.common.copied}</>
              : <><Copy className="w-3 h-3" /> {t.common.copy}</>}
            </Button>
          </div>
          <pre className="typo-caption font-mono bg-surface-2 border border-hair rounded-card
                         p-2.5 overflow-x-auto text-ink-1 whitespace-pre-wrap break-all">
            {snippet}
          </pre>
        </div>
      )}

      {/* Response viewer */}
      {response && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 typo-caption">
            <span className="typo-eyebrow text-ink-2">{dt.response_label}</span>
            <span className={`px-1.5 py-0.5 rounded-interactive font-medium ${
              response.status === 'success'
                ? 'bg-status-success/10 text-status-success'
                : 'bg-status-error/10 text-status-error'
            }`}>
              {response.status === 'success' ? dt.local_run_completed : dt.local_run_failed}
            </span>
            {response.durationMs != null && (
              <Numeric value={response.durationMs} unit="ms" className="text-ink-1" />
            )}
            {response.costUsd != null && response.costUsd > 0 && (
              <Numeric value={response.costUsd} unit="usd" className="text-ink-1" />
            )}
            {response.model && (
              <span className="text-ink-1">{response.model}</span>
            )}
          </div>
          <pre className={`typo-code rounded-card p-2.5 overflow-x-auto whitespace-pre-wrap break-words
                          border max-h-64 overflow-y-auto ${
            response.status === 'success'
              ? 'bg-status-success/5 border-status-success/15 text-ink-1'
              : 'bg-status-error/5 border-status-error/15 text-status-error'
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
