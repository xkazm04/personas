import { useTranslation } from '@/i18n/useTranslation';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Play } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SqlEditor } from '@/features/vault/sub_databases/SqlEditor';
import { Section, KeyValueEditor, initQueryParams, formatSchema, type KeyValue } from './BuilderParams';
import type { ApiEndpoint } from '@/api/system/apiProxy';

// -- HTTP Methods -------------------------------------------------

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// -- Component ----------------------------------------------------

interface RequestBuilderProps {
  endpoint: ApiEndpoint | null;
  onSend: (method: string, path: string, headers: Record<string, string>, body?: string) => Promise<void>;
  isSending: boolean;
}

export function RequestBuilder({ endpoint, onSend, isSending }: RequestBuilderProps) {
  const { t } = useTranslation();
  const vt = t.vault.playground_extra;
  const [method, setMethod] = useState(endpoint?.method.toUpperCase() || 'GET');
  const [path, setPath] = useState(endpoint?.path || '/');
  const [queryParams, setQueryParams] = useState<KeyValue[]>(() => initQueryParams(endpoint));
  const [headers, setHeaders] = useState<KeyValue[]>([{ key: 'Content-Type', value: 'application/json' }]);
  const [body, setBody] = useState('');

  const endpointKey = endpoint ? `${endpoint.method}:${endpoint.path}` : '';
  useEffect(() => {
    if (!endpoint) return;
    setMethod(endpoint.method.toUpperCase());
    setPath(endpoint.path);
    setQueryParams(initQueryParams(endpoint));
    setBody(endpoint.request_body?.schema_json ? formatSchema(endpoint.request_body.schema_json) : '');
  }, [endpoint, endpointKey]);

  const pathParams = useMemo(() => {
    const matches = path.match(/\{([^}]+)\}/g) || [];
    return matches.map((m) => m.slice(1, -1));
  }, [path]);

  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>({});

  const resolvedPath = useMemo(() => {
    let resolved = path;
    for (const [key, val] of Object.entries(pathParamValues)) {
      resolved = resolved.replace(`{${key}}`, encodeURIComponent(val || key));
    }
    const validQ = queryParams.filter((q) => q.key.trim());
    if (validQ.length > 0) {
      const qs = validQ.map((q) => `${encodeURIComponent(q.key)}=${encodeURIComponent(q.value)}`).join('&');
      resolved += (resolved.includes('?') ? '&' : '?') + qs;
    }
    return resolved;
  }, [path, pathParamValues, queryParams]);

  const handleSend = useCallback(async () => {
    const headerMap: Record<string, string> = {};
    headers.forEach((h) => { if (h.key.trim()) headerMap[h.key.trim()] = h.value; });
    const hasBody = ['POST', 'PUT', 'PATCH'].includes(method);
    await onSend(method, resolvedPath, headerMap, hasBody ? body : undefined);
  }, [method, resolvedPath, headers, body, onSend]);

  return (
    <div className="space-y-3">
      {/* Method + Path */}
      <div className="flex items-center gap-2">
        <select
          value={method}
          onChange={(e) => setMethod(e.target.value)}
          className="px-2 py-2 rounded-card text-sm font-bold bg-secondary/30 border border-primary/10 text-foreground/80 focus-visible:outline-none focus-visible:border-primary/30"
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/api/v1/resource"
          className="flex-1 px-3 py-2 rounded-modal text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/80 placeholder:text-muted-foreground/30 focus-visible:outline-none focus-visible:border-primary/30"
        />
        <button
          onClick={handleSend}
          disabled={isSending || !path.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-modal text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {isSending ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Path parameters */}
      {pathParams.length > 0 && (
        <Section label={vt.path_parameters}>
          <div className="space-y-1.5">
            {pathParams.map((param) => (
              <div key={param} className="flex items-center gap-2">
                <span className="text-sm font-mono text-violet-400/70 min-w-[100px]">{`{${param}}`}</span>
                <input
                  type="text"
                  value={pathParamValues[param] || ''}
                  onChange={(e) => setPathParamValues((prev) => ({ ...prev, [param]: e.target.value }))}
                  placeholder={param}
                  className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:border-primary/25"
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label={vt.query_parameters}>
        <KeyValueEditor entries={queryParams} onChange={setQueryParams} />
      </Section>

      <Section label={t.common.actions}>
        <KeyValueEditor entries={headers} onChange={setHeaders} />
      </Section>

      {['POST', 'PUT', 'PATCH'].includes(method) && (
        <Section label={vt.body_label}>
          <SqlEditor
            value={body}
            onChange={setBody}
            language="json"
            placeholder='{"key": "value"}'
            minHeight="80px"
          />
        </Section>
      )}

      <div className="text-sm font-mono text-muted-foreground/50 truncate">
        {'→'} {method} {resolvedPath}
      </div>
    </div>
  );
}
