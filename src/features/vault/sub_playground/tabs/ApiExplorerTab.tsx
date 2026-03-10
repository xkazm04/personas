import { Upload, FileText, Globe, Loader2, Search, X, PlayCircle, Square } from 'lucide-react';
import { EndpointRow } from '../EndpointRow';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import type { ApiEndpoint } from '@/api/system/apiProxy';
import { useApiExplorerState } from './useApiExplorerState';
import { apiTestLineClassName } from './apiExplorerHelpers';
import { EmptyState, TestRunCounters, RequestResponsePanel, PasteSpecModal } from './ApiExplorerSubComponents';

// ── Component ────────────────────────────────────────────────────

interface ApiExplorerTabProps {
  credentialId: string;
  catalogEndpoints?: ApiEndpoint[];
}

export function ApiExplorerTab({ credentialId, catalogEndpoints }: ApiExplorerTabProps) {
  const state = useApiExplorerState(credentialId, catalogEndpoints);

  // ── Render ─────────────────────────────────────────────────────

  if (state.loading) {
    return (
      <div className="flex items-center justify-center h-full py-20 gap-2">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground/60" />
        <span className="text-sm text-muted-foreground/60">Loading API definition...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <Globe className="w-4 h-4 text-muted-foreground/60" />
        <span className="text-sm font-medium text-foreground/80">
          {state.endpoints.length} example endpoint{state.endpoints.length !== 1 ? 's' : ''}
        </span>
        <div className="flex-1" />

        {/* Search */}
        {state.endpoints.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
            <input
              type="text"
              value={state.search}
              onChange={(e) => state.setSearch(e.target.value)}
              placeholder="Filter..."
              className="pl-6 pr-2 py-1.5 w-[180px] rounded text-sm bg-secondary/20 border border-primary/10 text-foreground/80 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/25"
            />
          </div>
        )}

        {/* Run All / Stop */}
        {state.endpoints.length > 0 && (
          state.testRunner.isRunning ? (
            <button
              onClick={state.testRunner.cancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors"
            >
              <Square className="w-3 h-3" />
              Stop
            </button>
          ) : (
            <button
              onClick={() => { state.testRunner.runAll(state.endpoints, credentialId); state.setShowLogPanel(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 transition-colors"
            >
              <PlayCircle className="w-3 h-3" />
              Run All
            </button>
          )
        )}

        <button
          onClick={() => state.fileInputRef.current?.click()}
          disabled={state.isParsing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 transition-colors"
        >
          <Upload className="w-3 h-3" />
          Upload Spec
        </button>
        <input
          ref={state.fileInputRef}
          type="file"
          accept=".json,.yaml,.yml"
          onChange={state.handleFileInputChange}
          className="hidden"
        />
        <button
          onClick={() => state.setShowPasteModal(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium bg-secondary/30 border border-primary/10 text-foreground/70 hover:bg-secondary/50 transition-colors"
        >
          <FileText className="w-3 h-3" />
          Paste OpenAPI
        </button>
      </div>

      {/* Parse error */}
      {state.parseError && (
        <div className="mx-4 mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-start gap-2">
          <span className="flex-1">{state.parseError}</span>
          <button onClick={() => state.setParseError(null)} className="text-red-400/50 hover:text-red-400">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* CLI log strip */}
      {(state.testRunner.lastLog || state.testRunner.progress) && (
        <TerminalStrip
          lastLine={state.testRunner.lastLog}
          lines={state.testRunner.lines}
          isRunning={state.testRunner.isRunning}
          isExpanded={state.showLogPanel}
          onToggle={() => state.setShowLogPanel(v => !v)}
          onClear={state.testRunner.clear}
          lineClassName={apiTestLineClassName}
          operation="credential_healthcheck"
          counters={state.testRunner.progress && (
            <TestRunCounters progress={state.testRunner.progress} />
          )}
        />
      )}

      {/* Main content */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {state.endpoints.length === 0 ? (
          <EmptyState onUpload={() => state.fileInputRef.current?.click()} onPaste={() => state.setShowPasteModal(true)} />
        ) : (
          <>
            {/* Endpoint list */}
            <div className="space-y-1">
              {state.filtered.map((ep, i) => (
                <EndpointRow
                  key={`${ep.method}:${ep.path}`}
                  endpoint={ep}
                  isExpanded={state.expandedIdx === i}
                  onToggle={() => state.setExpandedIdx(state.expandedIdx === i ? null : i)}
                  onTry={() => state.selectEndpointForTry(ep)}
                  testResult={state.testRunner.results.get(`${ep.method.toUpperCase()}:${ep.path}`)}
                />
              ))}
              {state.filtered.length === 0 && (
                <p className="text-sm text-muted-foreground/60 text-center py-4">
                  No endpoints match "{state.search}"
                </p>
              )}
            </div>

            {/* Request / Response */}
            {state.selectedEndpoint && (
              <div className="border-t border-primary/25 pt-4">
                <div className={`grid gap-0 ${state.response || state.sendError ? 'grid-cols-[1fr_1px_1fr]' : 'grid-cols-1'}`}>
                  <div className="space-y-4 min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="text-sm uppercase tracking-wider text-blue-400/70 font-semibold">
                        Request Builder
                      </span>
                      <div className="flex-1" />
                      <button
                        onClick={state.closeRequestPanel}
                        className="text-sm text-muted-foreground/60 hover:text-muted-foreground/80"
                      >
                        Close
                      </button>
                    </div>
                    <RequestBuilder
                      endpoint={state.selectedEndpoint}
                      onSend={state.handleSend}
                      isSending={state.isSending}
                    />
                  </div>

                  {(state.response || state.sendError) && (
                    <div className="bg-primary/25" />
                  )}

                  {(state.response || state.sendError) && (
                    <div className="min-w-0 pl-4">
                      <span className="text-sm uppercase tracking-wider text-emerald-400/70 font-semibold block mb-3">
                        Response
                      </span>
                      {state.sendError && (
                        <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 font-mono whitespace-pre-wrap">
                          {state.sendError}
                        </div>
                      )}
                      {state.response && <ResponseViewer response={state.response} />}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Paste modal */}
      {state.showPasteModal && (
        <PasteSpecModal
          pasteContent={state.pasteContent}
          setPasteContent={state.setPasteContent}
          isParsing={state.isParsing}
          onClose={() => { state.setShowPasteModal(false); state.setPasteContent(''); }}
          onSubmit={state.handlePasteSubmit}
        />
      )}
    </div>
  );
}
