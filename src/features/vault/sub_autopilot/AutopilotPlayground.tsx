import { useState, useCallback } from 'react';
import {
  ArrowLeft, Play, Loader2, Plus, Trash2, Copy, CheckCircle2, XCircle,
} from 'lucide-react';
import type { OpenApiParseResult } from '@/lib/bindings/OpenApiParseResult';
import type { GeneratedConnectorResult } from '@/lib/bindings/GeneratedConnectorResult';
import type { GeneratedToolDefinition } from '@/lib/bindings/GeneratedToolDefinition';
import type { PlaygroundTestResult } from '@/lib/bindings/PlaygroundTestResult';
import { openapiPlaygroundTest } from '@/api/vault/openapiAutopilot';

interface AutopilotPlaygroundProps {
  parseResult: OpenApiParseResult;
  generatedResult: GeneratedConnectorResult;
  onBack: () => void;
}

export function AutopilotPlayground({ parseResult, generatedResult, onBack }: AutopilotPlaygroundProps) {
  const [selectedTool, setSelectedTool] = useState<GeneratedToolDefinition | null>(
    generatedResult.tools[0] ?? null,
  );
  const [baseUrl, setBaseUrl] = useState(parseResult.baseUrl ?? '');
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([
    { key: 'Authorization', value: '' },
  ]);
  const [queryParams, setQueryParams] = useState<{ key: string; value: string }[]>([]);
  const [body, setBody] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<PlaygroundTestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTest = useCallback(async () => {
    if (!selectedTool) return;
    setIsTesting(true);
    setError(null);
    setTestResult(null);
    try {
      const headerMap: Record<string, string> = {};
      headers.forEach(h => { if (h.key.trim()) headerMap[h.key.trim()] = h.value; });

      const queryMap: Record<string, string> = {};
      queryParams.forEach(q => { if (q.key.trim()) queryMap[q.key.trim()] = q.value; });

      const result = await openapiPlaygroundTest(
        baseUrl.trim(),
        selectedTool.path,
        selectedTool.method,
        headerMap,
        queryMap,
        body.trim() || undefined,
      );
      setTestResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Object && 'error' in err ? (err as { error: string }).error : String(err);
      setError(msg);
    } finally {
      setIsTesting(false);
    }
  }, [selectedTool, baseUrl, headers, queryParams, body]);

  const addHeader = () => setHeaders(prev => [...prev, { key: '', value: '' }]);
  const removeHeader = (i: number) => setHeaders(prev => prev.filter((_, idx) => idx !== i));
  const updateHeader = (i: number, field: 'key' | 'value', val: string) => {
    setHeaders(prev => prev.map((h, idx) => idx === i ? { ...h, [field]: val } : h));
  };

  const addQueryParam = () => setQueryParams(prev => [...prev, { key: '', value: '' }]);
  const removeQueryParam = (i: number) => setQueryParams(prev => prev.filter((_, idx) => idx !== i));
  const updateQueryParam = (i: number, field: 'key' | 'value', val: string) => {
    setQueryParams(prev => prev.map((q, idx) => idx === i ? { ...q, [field]: val } : q));
  };

  const formatJson = (str: string): string => {
    try { return JSON.stringify(JSON.parse(str), null, 2); } catch { return str; }
  };

  return (
    <div className="animate-fade-slide-in space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground/80 hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div>
          <h3 className="text-sm font-semibold text-foreground">API Playground</h3>
          <p className="text-sm text-muted-foreground/60">Test your generated API tools before using them</p>
        </div>
      </div>

      <div className="grid grid-cols-[240px_1fr] gap-4">
        {/* Tool List Sidebar */}
        <div className="space-y-1 max-h-[70vh] overflow-y-auto rounded-lg border border-primary/10 p-2 bg-secondary/15">
          {generatedResult.tools.map((tool) => (
            <button
              key={tool.toolName}
              onClick={() => { setSelectedTool(tool); setTestResult(null); setError(null); }}
              className={`w-full text-left px-2 py-1.5 rounded-md text-xs transition-colors ${
                selectedTool?.toolName === tool.toolName
                  ? 'bg-blue-500/15 border border-blue-500/20 text-foreground'
                  : 'hover:bg-secondary/30 text-muted-foreground/70'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <MethodBadge method={tool.method} />
                <span className="font-mono truncate">{tool.path}</span>
              </div>
              <p className="text-muted-foreground/50 truncate mt-0.5">{tool.label}</p>
            </button>
          ))}
        </div>

        {/* Request Builder */}
        <div className="space-y-4">
          {selectedTool && (
            <>
              {/* Base URL */}
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground/60">Base URL</label>
                <input
                  type="url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="https://api.example.com"
                  className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-lg text-sm font-mono text-foreground focus:outline-none focus:border-blue-500/40"
                />
              </div>

              {/* Endpoint display */}
              <div className="flex items-center gap-2 px-3 py-2 bg-secondary/30 border border-primary/15 rounded-lg">
                <MethodBadge method={selectedTool.method} />
                <span className="text-sm font-mono text-foreground">{selectedTool.path}</span>
                <span className="text-xs text-muted-foreground/40 ml-auto">{selectedTool.description}</span>
              </div>

              {/* Headers */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs text-muted-foreground/60">Headers</label>
                  <button onClick={addHeader} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {headers.map((h, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={h.key}
                      onChange={(e) => updateHeader(i, 'key', e.target.value)}
                      placeholder="Header name"
                      className="flex-1 px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
                    />
                    <input
                      value={h.value}
                      onChange={(e) => updateHeader(i, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-[2] px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
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
                  <label className="text-xs text-muted-foreground/60">Query Parameters</label>
                  <button onClick={addQueryParam} className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {queryParams.map((q, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={q.key}
                      onChange={(e) => updateQueryParam(i, 'key', e.target.value)}
                      placeholder="Param name"
                      className="flex-1 px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
                    />
                    <input
                      value={q.value}
                      onChange={(e) => updateQueryParam(i, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-[2] px-2.5 py-1.5 bg-secondary/30 border border-primary/15 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40"
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
                  <label className="text-xs text-muted-foreground/60">Request Body (JSON)</label>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    placeholder='{ "key": "value" }'
                    rows={5}
                    className="w-full px-3 py-2 bg-secondary/30 border border-primary/15 rounded-lg text-xs font-mono text-foreground focus:outline-none focus:border-blue-500/40 resize-y"
                  />
                </div>
              )}

              {/* Send button */}
              <button
                onClick={handleTest}
                disabled={isTesting || !baseUrl.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-400 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isTesting ? 'Sending...' : 'Send Request'}
              </button>

              {/* Error */}
              {error && (
                <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
                  <XCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Response */}
              {testResult && (
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-1.5 ${testResult.success ? 'text-emerald-400' : 'text-red-400'}`}>
                      {testResult.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      <span className="text-sm font-medium">{testResult.statusCode}</span>
                    </div>
                    <span className="text-xs text-muted-foreground/50">{testResult.durationMs}ms</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(testResult.body)}
                      className="text-xs text-muted-foreground/50 hover:text-foreground flex items-center gap-1 ml-auto"
                    >
                      <Copy className="w-3 h-3" /> Copy
                    </button>
                  </div>

                  {/* Response Headers (collapsed by default) */}
                  <details className="text-xs">
                    <summary className="text-muted-foreground/50 cursor-pointer hover:text-muted-foreground">
                      Response Headers ({Object.keys(testResult.headers).length})
                    </summary>
                    <div className="mt-1 p-2 bg-secondary/20 rounded-lg font-mono space-y-0.5 max-h-32 overflow-y-auto">
                      {Object.entries(testResult.headers).map(([k, v]) => (
                        <div key={k}>
                          <span className="text-blue-400">{k}</span>: <span className="text-muted-foreground/70">{v}</span>
                        </div>
                      ))}
                    </div>
                  </details>

                  {/* Response Body */}
                  <div className="relative">
                    <pre className="p-3 bg-secondary/20 border border-primary/10 rounded-lg text-xs font-mono text-foreground/80 overflow-auto max-h-80 whitespace-pre-wrap">
                      {formatJson(testResult.body)}
                    </pre>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MethodBadge({ method }: { method: string }) {
  const colors: Record<string, string> = {
    GET: 'text-emerald-400 bg-emerald-500/15',
    POST: 'text-blue-400 bg-blue-500/15',
    PUT: 'text-amber-400 bg-amber-500/15',
    PATCH: 'text-orange-400 bg-orange-500/15',
    DELETE: 'text-red-400 bg-red-500/15',
    HEAD: 'text-purple-400 bg-purple-500/15',
    OPTIONS: 'text-gray-400 bg-gray-500/15',
  };
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wider shrink-0 ${colors[method] ?? 'text-gray-400 bg-gray-500/15'}`}>
      {method}
    </span>
  );
}
