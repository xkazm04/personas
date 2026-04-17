import { Plus, Trash2 } from 'lucide-react';
import { MethodBadge } from './AutopilotShared';
import type { GeneratedToolDefinition } from '@/lib/bindings/GeneratedToolDefinition';
import { useTranslation } from '@/i18n/useTranslation';

interface PlaygroundRequestBuilderProps {
  selectedTool: GeneratedToolDefinition;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  headers: { key: string; value: string }[];
  addHeader: () => void;
  removeHeader: (i: number) => void;
  updateHeader: (i: number, field: 'key' | 'value', val: string) => void;
  queryParams: { key: string; value: string }[];
  addQueryParam: () => void;
  removeQueryParam: (i: number) => void;
  updateQueryParam: (i: number, field: 'key' | 'value', val: string) => void;
  body: string;
  setBody: (body: string) => void;
}

export function PlaygroundRequestBuilder({
  selectedTool,
  baseUrl,
  setBaseUrl,
  headers,
  addHeader,
  removeHeader,
  updateHeader,
  queryParams,
  addQueryParam,
  removeQueryParam,
  updateQueryParam,
  body,
  setBody,
}: PlaygroundRequestBuilderProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* Base URL */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/60">{t.vault.autopilot.base_url}</label>
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://api.example.com"
          className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-card text-sm font-mono text-foreground focus:outline-none focus:border-blue-500/40"
        />
      </div>

      {/* Endpoint display */}
      <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border border-primary/15 rounded-card">
        <MethodBadge method={selectedTool.method} />
        <span className="text-sm font-mono text-foreground">{selectedTool.path}</span>
        <span className="text-xs text-muted-foreground/40 ml-auto">{selectedTool.description}</span>
      </div>

      {/* Headers */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground/60">{t.vault.autopilot.headers_label}</label>
          <button onClick={addHeader} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {headers.map((h, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={h.key}
              onChange={(e) => updateHeader(i, 'key', e.target.value)}
              placeholder={t.vault.autopilot.header_name_placeholder}
              className="flex-1 px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-card text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
            />
            <input
              value={h.value}
              onChange={(e) => updateHeader(i, 'value', e.target.value)}
              placeholder="Value"
              className="flex-[2] px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-card text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
            />
            <button onClick={() => removeHeader(i)} className="text-muted-foreground/40 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Query Params */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground/60">{t.vault.autopilot.query_parameters}</label>
          <button onClick={addQueryParam} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add
          </button>
        </div>
        {queryParams.map((q, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={q.key}
              onChange={(e) => updateQueryParam(i, 'key', e.target.value)}
              placeholder={t.vault.autopilot.param_name_placeholder}
              className="flex-1 px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-card text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
            />
            <input
              value={q.value}
              onChange={(e) => updateQueryParam(i, 'value', e.target.value)}
              placeholder="Value"
              className="flex-[2] px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-card text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
            />
            <button onClick={() => removeQueryParam(i)} className="text-muted-foreground/40 hover:text-red-400">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Body (for POST/PUT/PATCH) */}
      {['POST', 'PUT', 'PATCH'].includes(selectedTool.method) && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground/60">{t.vault.autopilot.request_body}</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder='{ "key": "value" }'
            rows={5}
            className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-card text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40 resize-y"
          />
        </div>
      )}
    </>
  );
}
