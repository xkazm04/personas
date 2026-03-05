import { useState, useCallback, useMemo, useEffect } from 'react';
import { Play, Loader2, Plus, Trash2 } from 'lucide-react';
import { SqlEditor } from '@/features/vault/sub_databases/SqlEditor';
import type { ApiEndpoint, ApiParameter } from '@/api/apiProxy';

// ── Types ────────────────────────────────────────────────────────

interface KeyValue {
  key: string;
  value: string;
}

interface RequestBuilderProps {
  endpoint: ApiEndpoint | null;
  onSend: (method: string, path: string, headers: Record<string, string>, body?: string) => Promise<void>;
  isSending: boolean;
}

// ── HTTP Methods ─────────────────────────────────────────────────

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ── Component ────────────────────────────────────────────────────

export function RequestBuilder({ endpoint, onSend, isSending }: RequestBuilderProps) {
  const [method, setMethod] = useState(endpoint?.method.toUpperCase() || 'GET');
  const [path, setPath] = useState(endpoint?.path || '/');
  const [queryParams, setQueryParams] = useState<KeyValue[]>(() => initQueryParams(endpoint));
  const [headers, setHeaders] = useState<KeyValue[]>([{ key: 'Content-Type', value: 'application/json' }]);
  const [body, setBody] = useState('');

  // Sync from endpoint selection
  const endpointKey = endpoint ? `${endpoint.method}:${endpoint.path}` : '';
  useEffect(() => {
    if (!endpoint) return;
    setMethod(endpoint.method.toUpperCase());
    setPath(endpoint.path);
    setQueryParams(initQueryParams(endpoint));
    setBody(endpoint.request_body?.schema_json ? formatSchema(endpoint.request_body.schema_json) : '');
  }, [endpoint, endpointKey]);

  // Path params extracted from {param} patterns
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
    // Append query params
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
          className="px-2 py-2 rounded-lg text-sm font-bold bg-secondary/30 border border-primary/10 text-foreground/80 focus:outline-none focus:border-primary/30"
        >
          {METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/api/v1/resource"
          className="flex-1 px-3 py-2 rounded-lg text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/80 placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30"
        />

        <button
          onClick={handleSend}
          disabled={isSending || !path.trim()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {isSending ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Play className="w-3.5 h-3.5" />
          )}
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>

      {/* Path parameters */}
      {pathParams.length > 0 && (
        <Section label="Path Parameters">
          <div className="space-y-1.5">
            {pathParams.map((param) => (
              <div key={param} className="flex items-center gap-2">
                <span className="text-sm font-mono text-violet-400/70 min-w-[100px]">{`{${param}}`}</span>
                <input
                  type="text"
                  value={pathParamValues[param] || ''}
                  onChange={(e) => setPathParamValues((prev) => ({ ...prev, [param]: e.target.value }))}
                  placeholder={param}
                  className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary/25"
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Query Parameters */}
      <Section label="Query Parameters">
        <KeyValueEditor entries={queryParams} onChange={setQueryParams} />
      </Section>

      {/* Headers */}
      <Section label="Headers">
        <KeyValueEditor entries={headers} onChange={setHeaders} />
      </Section>

      {/* Body */}
      {['POST', 'PUT', 'PATCH'].includes(method) && (
        <Section label="Body">
          <SqlEditor
            value={body}
            onChange={setBody}
            language="json"
            placeholder='{"key": "value"}'
            minHeight="80px"
          />
        </Section>
      )}

      {/* Resolved URL preview */}
      <div className="text-sm font-mono text-muted-foreground/30 truncate">
        → {method} {resolvedPath}
      </div>
    </div>
  );
}

// ── Section wrapper ──────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <span className="text-sm uppercase tracking-wider text-muted-foreground/30 font-semibold">
        {label}
      </span>
      {children}
    </div>
  );
}

// ── Key-Value editor ─────────────────────────────────────────────

function KeyValueEditor({
  entries,
  onChange,
}: {
  entries: KeyValue[];
  onChange: (entries: KeyValue[]) => void;
}) {
  const update = (i: number, field: 'key' | 'value', val: string) => {
    const next = [...entries];
    next[i] = { ...next[i]!, [field]: val };
    onChange(next);
  };

  const remove = (i: number) => {
    onChange(entries.filter((_, idx) => idx !== i));
  };

  const add = () => {
    onChange([...entries, { key: '', value: '' }]);
  };

  return (
    <div className="space-y-1">
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="text"
            value={entry.key}
            onChange={(e) => update(i, 'key', e.target.value)}
            placeholder="key"
            className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary/25"
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => update(i, 'value', e.target.value)}
            placeholder="value"
            className="flex-1 px-2 py-1.5 rounded text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary/25"
          />
          <button
            onClick={() => remove(i)}
            className="p-1 rounded text-muted-foreground/30 hover:text-red-400/60 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      ))}
      <button
        onClick={add}
        className="flex items-center gap-1 px-2 py-1 rounded text-sm text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-secondary/30 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Add
      </button>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────

function initQueryParams(endpoint: ApiEndpoint | null): KeyValue[] {
  if (!endpoint) return [];
  const queryParams = endpoint.parameters.filter((p: ApiParameter) => p.location === 'query');
  if (queryParams.length === 0) return [];
  return queryParams.map((p: ApiParameter) => ({ key: p.name, value: '' }));
}

function formatSchema(schemaJson: string): string {
  try {
    return JSON.stringify(JSON.parse(schemaJson), null, 2);
  } catch {
    return schemaJson;
  }
}
