import { useState, useCallback } from 'react';
import { ArrowLeft, Play, Loader2 } from 'lucide-react';
import type { OpenApiParseResult } from '@/lib/bindings/OpenApiParseResult';
import type { GeneratedConnectorResult } from '@/lib/bindings/GeneratedConnectorResult';
import type { GeneratedToolDefinition } from '@/lib/bindings/GeneratedToolDefinition';
import type { PlaygroundTestResult } from '@/lib/bindings/PlaygroundTestResult';
import { openapiPlaygroundTest } from '@/api/vault/openapiAutopilot';
import { MethodBadge } from './AutopilotShared';
import { PlaygroundRequestBuilder } from './PlaygroundRequestBuilder';
import { PlaygroundOutput } from './PlaygroundOutput';

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
              <PlaygroundRequestBuilder
                selectedTool={selectedTool}
                baseUrl={baseUrl}
                setBaseUrl={setBaseUrl}
                headers={headers}
                addHeader={addHeader}
                removeHeader={removeHeader}
                updateHeader={updateHeader}
                queryParams={queryParams}
                addQueryParam={addQueryParam}
                removeQueryParam={removeQueryParam}
                updateQueryParam={updateQueryParam}
                body={body}
                setBody={setBody}
              />

              {/* Send button */}
              <button
                onClick={handleTest}
                disabled={isTesting || !baseUrl.trim()}
                className="flex items-center gap-2 px-4 py-2.5 bg-violet-500/15 hover:bg-violet-500/25 border border-violet-500/30 text-violet-400 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                {isTesting ? 'Sending...' : 'Send Request'}
              </button>

              <PlaygroundOutput error={error} testResult={testResult} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
