import { useTranslation } from '@/i18n/useTranslation';
import { Upload, FileText, Globe, Search, SearchX, X, PlayCircle, Square } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import { Button } from '@/features/shared/components/buttons';
import { EndpointRow } from '../EndpointRow';
import { TerminalStrip } from '@/features/shared/components/terminal/TerminalStrip';
import type { ApiEndpoint } from '@/api/system/apiProxy';
import { useApiExplorerState } from './useApiExplorerState';
import { apiTestLineClassName } from './apiExplorerHelpers';
import { EmptyState, TestRunCounters, PasteSpecModal } from './ApiExplorerSubComponents';
import { RequestBuilder } from '../RequestBuilder';
import { ResponseViewer } from '../ResponseViewer';

interface ApiExplorerTabProps {
  credentialId: string;
  catalogEndpoints?: ApiEndpoint[];
}

export function ApiExplorerTab({ credentialId, catalogEndpoints }: ApiExplorerTabProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const state = useApiExplorerState(credentialId, catalogEndpoints);

  if (state.loading) {
    return (
      <div className="flex items-center justify-center py-12 text-foreground">
        <LoadingSpinner size="lg" label={sh.loading_api} />
      </div>
    );
  }

  const endpointCountLabel = state.endpoints.length === 1
    ? tx(sh.example_endpoints_one, { count: state.endpoints.length })
    : tx(sh.example_endpoints_other, { count: state.endpoints.length });

  return (
    <div className="flex flex-col h-full">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/5 shrink-0">
        <Globe className="w-4 h-4 text-foreground" />
        <span className="typo-body font-medium text-foreground">
          {endpointCountLabel}
        </span>
        <div className="flex-1" />

        {state.endpoints.length > 0 && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground" />
            <input
              type="text"
              value={state.search}
              onChange={(e) => state.setSearch(e.target.value)}
              placeholder={sh.filter}
              className="pl-6 pr-2 py-1.5 w-[180px] rounded typo-body bg-secondary/20 border border-primary/10 text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/25"
            />
          </div>
        )}

        {state.endpoints.length > 0 && (
          state.testRunner.isRunning ? (
            <Button variant="danger" size="sm" icon={<Square className="w-3 h-3" />} onClick={state.testRunner.cancel}>{sh.stop}</Button>
          ) : (
            <Button
              variant="primary" size="sm" icon={<PlayCircle className="w-3 h-3" />}
              onClick={() => { state.testRunner.runAll(state.endpoints, credentialId); state.setShowLogPanel(true); }}
              className="bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20"
            >{sh.run_all}</Button>
          )
        )}

        <Button variant="secondary" size="sm" icon={<Upload className="w-3 h-3" />} onClick={() => state.fileInputRef.current?.click()} disabled={state.isParsing}>{sh.upload_spec}</Button>
        <input ref={state.fileInputRef} type="file" accept=".json,.yaml,.yml" onChange={state.handleFileInputChange} className="hidden" />
        <Button variant="secondary" size="sm" icon={<FileText className="w-3 h-3" />} onClick={() => state.setShowPasteModal(true)}>{sh.paste_openapi}</Button>
      </div>

      {state.parseError && (
        <div className="mx-4 mt-3 p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400 flex items-start gap-2">
          <span className="flex-1">{state.parseError}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => state.setParseError(null)} className="text-red-400/50 hover:text-red-400">
            <X className="w-3 h-3" />
          </Button>
        </div>
      )}

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
          counters={state.testRunner.progress && <TestRunCounters progress={state.testRunner.progress} />}
        />
      )}

      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {state.endpoints.length === 0 ? (
          <EmptyState onUpload={() => state.fileInputRef.current?.click()} onPaste={() => state.setShowPasteModal(true)} />
        ) : (
          <>
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
                <EmptyIllustration icon={SearchX} heading={tx(sh.no_endpoints_match, { search: state.search })} description={sh.no_endpoints_match_hint} className="py-4" />
              )}
            </div>

            {state.selectedEndpoint && (
              <div className="border-t border-primary/25 pt-4">
                <div className={`grid gap-0 ${state.response || state.sendError ? 'grid-cols-[1fr_1px_1fr]' : 'grid-cols-1'}`}>
                  <div className="space-y-4 min-w-0 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="typo-heading uppercase tracking-wider text-blue-400/70 font-semibold">{sh.request_builder}</span>
                      <div className="flex-1" />
                      <Button variant="ghost" size="sm" onClick={state.closeRequestPanel} className="text-foreground hover:text-muted-foreground/80">{t.common.close}</Button>
                    </div>
                    <RequestBuilder endpoint={state.selectedEndpoint} onSend={state.handleSend} isSending={state.isSending} />
                  </div>

                  {(state.response || state.sendError) && <div className="bg-primary/25" />}
                  {(state.response || state.sendError) && (
                    <div className="min-w-0 pl-4">
                      <span className="typo-heading uppercase tracking-wider text-emerald-400/70 font-semibold block mb-3">{sh.response}</span>
                      {state.sendError && (
                        <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-code text-red-400 font-mono whitespace-pre-wrap">{state.sendError}</div>
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
