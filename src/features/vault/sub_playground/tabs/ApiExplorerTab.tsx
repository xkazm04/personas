import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Upload, FileText, Globe, Loader2, Search, X, PlayCircle, Square, CheckCircle2, XCircle, MinusCircle } from 'lucide-react';
import { EndpointRow } from '../EndpointRow';
import { RequestBuilder } from '../RequestBuilder';
import { ResponseViewer } from '../ResponseViewer';
import { useApiTestRunner } from '../useApiTestRunner';
import { TerminalStrip } from '@/features/shared/components/TerminalStrip';
import {
  executeApiRequest,
  parseApiDefinition,
  saveApiDefinition,
  loadApiDefinition,
} from '@/api/apiProxy';
import type { ApiEndpoint, ApiProxyResponse } from '@/api/apiProxy';

// ── Component ────────────────────────────────────────────────────

interface ApiExplorerTabProps {
  credentialId: string;
  catalogEndpoints?: ApiEndpoint[];
}

export function ApiExplorerTab({ credentialId, catalogEndpoints }: ApiExplorerTabProps) {
  const [endpoints, setEndpoints] = useState<ApiEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [parseError, setParseError] = useState<string | null>(null);

  // Selection + testing state
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [selectedEndpoint, setSelectedEndpoint] = useState<ApiEndpoint | null>(null);
  const [response, setResponse] = useState<ApiProxyResponse | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Search / filter
  const [search, setSearch] = useState('');

  // Paste modal
  const [showPasteModal, setShowPasteModal] = useState(false);
  const [pasteContent, setPasteContent] = useState('');
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Batch test runner ────────────────────────────────────────────
  const testRunner = useApiTestRunner();
  const [showLogPanel, setShowLogPanel] = useState(false);

  // ── Load saved definition on mount ─────────────────────────────

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadApiDefinition(credentialId);
        if (!cancelled && saved) {
          setEndpoints((prev) => mergeEndpoints(prev, saved));
        }
      } catch {
        // No saved definition
      }
      // Merge catalog endpoints
      if (!cancelled && catalogEndpoints?.length) {
        setEndpoints((prev) => mergeEndpoints(prev, catalogEndpoints));
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [credentialId, catalogEndpoints]);

  // ── File upload handler ────────────────────────────────────────

  const handleFileUpload = useCallback(async (file: File) => {
    setParseError(null);
    setIsParsing(true);
    try {
      const text = await file.text();
      const parsed = await parseApiDefinition(text);
      setEndpoints((prev) => mergeEndpoints(prev, parsed));
      await saveApiDefinition(credentialId, text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse API definition');
    } finally {
      setIsParsing(false);
    }
  }, [credentialId]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    e.target.value = '';
  }, [handleFileUpload]);

  // ── Paste spec handler ─────────────────────────────────────────

  const handlePasteSubmit = useCallback(async () => {
    if (!pasteContent.trim()) return;
    setParseError(null);
    setIsParsing(true);
    try {
      const parsed = await parseApiDefinition(pasteContent);
      setEndpoints((prev) => mergeEndpoints(prev, parsed));
      await saveApiDefinition(credentialId, pasteContent);
      setShowPasteModal(false);
      setPasteContent('');
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse API definition');
    } finally {
      setIsParsing(false);
    }
  }, [credentialId, pasteContent]);

  // ── Send request ───────────────────────────────────────────────

  const handleSend = useCallback(async (method: string, path: string, headers: Record<string, string>, body?: string) => {
    setIsSending(true);
    setSendError(null);
    setResponse(null);
    try {
      const res = await executeApiRequest(credentialId, method, path, headers, body);
      setResponse(res);
    } catch (err) {
      const raw = err instanceof Error ? err.message : typeof err === 'object' && err !== null ? JSON.stringify(err, null, 2) : String(err);
      setSendError(raw);
    } finally {
      setIsSending(false);
    }
  }, [credentialId]);

  // ── Filtered endpoints ─────────────────────────────────────────

  const filtered = useMemo(() => {
    if (!search.trim()) return endpoints;
    const q = search.toLowerCase();
    return endpoints.filter((ep) =>
      ep.path.toLowerCase().includes(q) ||
      ep.method.toLowerCase().includes(q) ||
      ep.summary?.toLowerCase().includes(q) ||
      ep.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [endpoints, search]);

  // ── Render ─────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/40" />
        <span className="text-sm text-muted-foreground/40">Loading API definition...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <Globe className="w-4 h-4 text-muted-foreground/40" />
        <span className="text-sm font-medium text-foreground/70">
          {endpoints.length} endpoint{endpoints.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />

        {/* Search */}
        {endpoints.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/30" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter..."
              className="pl-6 pr-2 py-1.5 w-[180px] rounded text-sm bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 focus:outline-none focus:border-primary/25"
            />
          </div>
        )}

        {/* Run All / Stop */}
        {endpoints.length > 0 && (
          testRunner.isRunning ? (
            <button
              onClick={testRunner.cancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => { testRunner.runAll(endpoints, credentialId); setShowLogPanel(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
            >
              <PlayCircle className="w-3 h-3" />
              Run All
            </button>
          )
        )}

        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={isParsing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload Spec
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.yaml,.yml"
          onChange={handleFileInputChange}
          className="hidden"
        />
        <button
          onClick={() => setShowPasteModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 transition-colors"
        >
          <FileText className="w-3 h-3" />
          Paste OpenAPI
        </button>
      </div>

      {/* Parse error */}
      {parseError && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
          <span className="flex-1">{parseError}</span>
          <button onClick={() => setParseError(null)} className="text-red-400/50 hover:text-red-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* CLI log strip */}
      {(testRunner.lastLog || testRunner.progress) && (
        <TerminalStrip
          lastLine={testRunner.lastLog}
          lines={testRunner.lines}
          isRunning={testRunner.isRunning}
          isExpanded={showLogPanel}
          onToggle={() => setShowLogPanel(v => !v)}
          onClear={testRunner.clear}
          lineClassName={apiTestLineClassName}
          counters={testRunner.progress && (
            <TestRunCounters progress={testRunner.progress} />
          )}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {endpoints.length === 0 ? (
          <EmptyState onUpload={() => fileInputRef.current?.click()} onPaste={() => setShowPasteModal(true)} />
        ) : (
          <>
            {/* Endpoint list */}
            <div className="space-y-1">
              {filtered.map((ep, i) => (
                <EndpointRow
                  key={`${ep.method}:${ep.path}`}
                  endpoint={ep}
                  isExpanded={expandedIdx === i}
                  onToggle={() => setExpandedIdx(expandedIdx === i ? null : i)}
                  onTry={() => {
                    setSelectedEndpoint(ep);
                    setResponse(null);
                    setSendError(null);
                  }}
                  testResult={testRunner.results.get(`${ep.method.toUpperCase()}:${ep.path}`)}
                />
              ))}
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground/40 text-center py-4">
                  No endpoints match "{search}"
                </p>
              )}
            </div>

            {/* Request builder */}
            {selectedEndpoint && (
              <div className="border-t border-primary/8 pt-4 space-y-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm uppercase tracking-wider text-muted-foreground/30 font-semibold">
                    Request Builder
                  </span>
                  <div className="flex-1" />
                  <button
                    onClick={() => { setSelectedEndpoint(null); setResponse(null); setSendError(null); }}
                    className="text-sm text-muted-foreground/40 hover:text-muted-foreground/60"
                  >
                    Close
                  </button>
                </div>
                <RequestBuilder
                  endpoint={selectedEndpoint}
                  onSend={handleSend}
                  isSending={isSending}
                />
              </div>
            )}

            {/* Response viewer */}
            {sendError && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
                {sendError}
              </div>
            )}
            {response && (
              <div className="border-t border-primary/8 pt-4">
                <span className="text-sm uppercase tracking-wider text-muted-foreground/30 font-semibold block mb-3">
                  Response
                </span>
                <ResponseViewer response={response} />
              </div>
            )}
          </>
        )}
      </div>

      {/* Paste modal */}
      {showPasteModal && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 backdrop-blur-sm rounded-2xl">
          <div className="w-full max-w-2xl mx-4 bg-background border border-primary/15 rounded-xl shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground/80">Paste OpenAPI / Swagger Spec</h3>
              <button
                onClick={() => { setShowPasteModal(false); setPasteContent(''); }}
                className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <textarea
              value={pasteContent}
              onChange={(e) => setPasteContent(e.target.value)}
              placeholder="Paste your OpenAPI JSON or YAML spec here..."
              className="w-full h-[300px] p-3 rounded-lg text-sm font-mono bg-secondary/20 border border-primary/10 text-foreground/70 placeholder:text-muted-foreground/25 resize-none focus:outline-none focus:border-primary/25"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowPasteModal(false); setPasteContent(''); }}
                className="px-3 py-2 rounded-lg text-sm text-muted-foreground/60 hover:bg-secondary/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handlePasteSubmit}
                disabled={isParsing || !pasteContent.trim()}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors"
              >
                {isParsing ? <Loader2 className="w-3 h-3 animate-spin" /> : <FileText className="w-3 h-3" />}
                {isParsing ? 'Parsing...' : 'Parse & Load'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Empty state ──────────────────────────────────────────────────

function EmptyState({ onUpload, onPaste }: { onUpload: () => void; onPaste: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 space-y-4">
      <Globe className="w-10 h-10 text-muted-foreground/15" />
      <div className="text-center space-y-1">
        <p className="text-sm text-muted-foreground/50">No API endpoints loaded</p>
        <p className="text-sm text-muted-foreground/30">
          Upload an OpenAPI/Swagger spec to explore and test API endpoints.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onUpload}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors"
        >
          <Upload className="w-3.5 h-3.5" />
          Upload Spec File
        </button>
        <button
          onClick={onPaste}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 transition-colors"
        >
          <FileText className="w-3.5 h-3.5" />
          Paste OpenAPI
        </button>
      </div>
    </div>
  );
}

// ── Test-run counters (passed into TerminalStrip.counters) ──────

import type { TestProgress } from '../useApiTestRunner';

function TestRunCounters({ progress }: { progress: TestProgress }) {
  return (
    <div className="flex items-center gap-2.5 shrink-0 text-sm font-medium">
      <span className="text-muted-foreground/40">
        {progress.current}/{progress.total}
      </span>
      {progress.passed > 0 && (
        <span className="flex items-center gap-0.5 text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          {progress.passed}
        </span>
      )}
      {progress.failed > 0 && (
        <span className="flex items-center gap-0.5 text-red-400">
          <XCircle className="w-3 h-3" />
          {progress.failed}
        </span>
      )}
      {progress.skipped > 0 && (
        <span className="flex items-center gap-0.5 text-muted-foreground/30">
          <MinusCircle className="w-3 h-3" />
          {progress.skipped}
        </span>
      )}
    </div>
  );
}

/** Line classifier for API test output (✓/✗/→ markers). */
function apiTestLineClassName(line: string): string {
  if (line.includes('✓')) return 'text-emerald-400/70';
  if (line.includes('✗')) return 'text-red-400/70';
  if (line.includes('→')) return 'text-blue-400/50';
  if (line.includes('Done:') || line.includes('Starting')) return 'text-foreground/60';
  return 'text-muted-foreground/40';
}

// ── Helpers ──────────────────────────────────────────────────────

function mergeEndpoints(existing: ApiEndpoint[], incoming: ApiEndpoint[]): ApiEndpoint[] {
  const seen = new Set(existing.map((ep) => `${ep.method.toUpperCase()}:${ep.path}`));
  const merged = [...existing];
  for (const ep of incoming) {
    const key = `${ep.method.toUpperCase()}:${ep.path}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(ep);
    }
  }
  return merged;
}
