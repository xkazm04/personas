import { useTranslation } from '@/i18n/useTranslation';
import { useState, useCallback, useMemo, useEffect } from 'react';
import { Play } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { SqlEditor } from '@/features/vault/sub_databases/SqlEditor';
import { Section, KeyValueEditor, initQueryParams, type KeyValue } from './BuilderParams';
import type { ApiEndpoint } from '@/api/system/apiProxy';
import { prettyJson } from './prettyJson';
import { seedPathParams, type ScopedResources } from './scopeParamSeed';

// -- HTTP Methods -------------------------------------------------

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// -- Component ----------------------------------------------------

interface RequestBuilderProps {
  endpoint: ApiEndpoint | null;
  onSend: (method: string, path: string, headers: Record<string, string>, body?: string) => Promise<void>;
  isSending: boolean;
  /**
   * The credential's recorded scope picks. Used to pre-fill `{owner}`/`{repo}`/
   * `{project}` -- the picker already asked which resource this credential is
   * for, and re-typing it into every Try was asking the same question twice.
   * The fields stay editable; this only changes what they open with.
   */
  scopedResources?: ScopedResources;
}

export function RequestBuilder({ endpoint, onSend, isSending, scopedResources }: RequestBuilderProps) {
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
    setPathParamValues(seedPathParams(endpoint.path, scopedResources));
    setBody(endpoint.request_body?.schema_json ? prettyJson(endpoint.request_body.schema_json) : '');
  }, [endpoint, endpointKey, scopedResources]);

  const pathParams = useMemo(() => {
    const matches = path.match(/\{([^}]+)\}/g) || [];
    return matches.map((m) => m.slice(1, -1));
  }, [path]);

  const [pathParamValues, setPathParamValues] = useState<Record<string, string>>(
    () => seedPathParams(endpoint?.path ?? '', scopedResources),
  );

  const resolvedPath = useMemo(() => {
    let resolved = path;
    // An empty param stays `{name}`: it used to be filled with its own NAME,
    // so a blank {owner} sent GET /repos/owner/... to a real, wrong resource.
    for (const [key, val] of Object.entries(pathParamValues)) {
      if (val.trim()) resolved = resolved.replaceAll(`{${key}}`, encodeURIComponent(val));
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
          className="px-2 py-2 rounded-card typo-heading bg-secondary/30 border border-primary/10 text-foreground focus-visible:outline-none focus-visible:border-primary/30"
        >
          {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder={t.vault.shared.api_path_placeholder}
          className="flex-1 px-3 py-2 rounded-modal typo-code bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/30"
        />
        {/* LoadingSpinner renders null, so the old busy state was the icon
            vanishing. Button's own spinner is real. */}
        <Button
          variant="accent"
          tone="success"
          size="md"
          icon={<Play className="w-3.5 h-3.5" />}
          onClick={handleSend}
          disabled={!path.trim() || pathParams.some((p) => !pathParamValues[p]?.trim())}
          loading={isSending}
          loadingLabel={t.vault.shared.sending}
          className="shrink-0"
        >
          {t.vault.shared.send}
        </Button>
      </div>

      {/* Path parameters */}
      {pathParams.length > 0 && (
        <Section label={vt.path_parameters}>
          <div className="space-y-1.5">
            {pathParams.map((param) => (
              <div key={param} className="flex items-center gap-2">
                <span className="typo-code text-violet-400/70 min-w-[100px]">{`{${param}}`}</span>
                <input
                  type="text"
                  value={pathParamValues[param] || ''}
                  onChange={(e) => setPathParamValues((prev) => ({ ...prev, [param]: e.target.value }))}
                  placeholder={param}
                  className="flex-1 px-2 py-1.5 rounded typo-code bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/25"
                />
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section label={vt.query_parameters}>
        <KeyValueEditor entries={queryParams} onChange={setQueryParams} />
      </Section>

      <Section label={vt.request_headers}>
        <KeyValueEditor entries={headers} onChange={setHeaders} />
      </Section>

      {['POST', 'PUT', 'PATCH'].includes(method) && (
        <Section label={vt.body_label}>
          <SqlEditor
            value={body}
            onChange={setBody}
            language="json"
            placeholder={t.vault.shared.json_body_placeholder}
            minHeight="80px"
          />
        </Section>
      )}

      <div className="typo-code text-foreground truncate">
        {'→'} {method} {resolvedPath}
      </div>
    </div>
  );
}
