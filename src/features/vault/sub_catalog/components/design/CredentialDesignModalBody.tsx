import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { CredentialDesignProvider } from '@/features/vault/sub_catalog/components/design/CredentialDesignContext';
import { IdlePhase } from '@/features/vault/sub_catalog/components/design/phases/IdlePhase';
import { AnalyzingPhase } from '@/features/vault/sub_catalog/components/design/phases/AnalyzingPhase';
import { PreviewPhase } from '@/features/vault/sub_catalog/components/design/phases/PreviewPhase';
import { DonePhase } from '@/features/vault/sub_catalog/components/design/phases/DonePhase';
import { ErrorPhase } from '@/features/vault/sub_catalog/components/design/phases/ErrorPhase';
import { AutoCredPanel } from '@/features/vault/sub_catalog/components/autoCred/steps/AutoCredPanel';
import { ImportSourcePicker, ImportInputPhase, ImportPreview } from '@/features/vault/sub_credentials/components/import';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { useCredentialDesignModal } from '@/features/vault/sub_catalog/components/design/useCredentialDesignModal';

type ModalHook = ReturnType<typeof useCredentialDesignModal>;

interface CredentialDesignModalBodyProps {
  orch: ModalHook['orch'];
  showImport: boolean;
  setShowImport: (v: boolean) => void;
  importFlow: ModalHook['importFlow'];
  handleImportComplete: () => void;
  autoSetupResult: CredentialDesignResult | null;
  setAutoSetupResult: (v: CredentialDesignResult | null) => void;
  autoSetupPending: boolean;
  handleKeyDown: (e: React.KeyboardEvent) => void;
  handleAutoSetup: () => void;
  handleClose: () => void;
  handleViewCredential: () => void;
  showTemplates: boolean;
  setShowTemplates: (v: boolean | ((prev: boolean) => boolean)) => void;
  templateSearch: string;
  setTemplateSearch: (v: string) => void;
  templateConnectors: ModalHook['templateConnectors'];
  expandedTemplateId: string | null;
  setExpandedTemplateId: (v: string | null) => void;
  applyTemplate: (connectorName: string) => void;
  onComplete: () => void;
}

export function CredentialDesignModalBody({
  orch,
  showImport,
  setShowImport,
  importFlow,
  handleImportComplete,
  autoSetupResult,
  setAutoSetupResult,
  autoSetupPending: _autoSetupPending,
  handleKeyDown,
  handleAutoSetup,
  handleClose,
  handleViewCredential,
  showTemplates,
  setShowTemplates,
  templateSearch,
  setTemplateSearch,
  templateConnectors,
  expandedTemplateId,
  setExpandedTemplateId,
  applyTemplate,
  onComplete,
}: CredentialDesignModalBodyProps) {
  return (
    <div className="p-6 space-y-6">
      {autoSetupResult ? (
        <AutoCredPanel
          designResult={autoSetupResult}
          onComplete={() => {
            setAutoSetupResult(null);
            onComplete();
          }}
          onCancel={() => {
            setAutoSetupResult(null);
            orch.resetAll();
          }}
        />
      ) : showImport ? (
        <>
          {importFlow.phase === 'pick_source' && (
            <ImportSourcePicker
              key="import-pick"
              onSelect={importFlow.selectSource}
              onBack={() => { setShowImport(false); importFlow.reset(); }}
            />
          )}
          {importFlow.phase === 'input' && importFlow.sourceId && (
            <ImportInputPhase
              key="import-input"
              sourceId={importFlow.sourceId}
              rawInput={importFlow.rawInput}
              onInputChange={importFlow.setRawInput}
              onParse={importFlow.parse}
              onBack={importFlow.goBack}
            />
          )}
          {importFlow.phase === 'preview' && importFlow.sourceId && importFlow.parseResult && (
            <ImportPreview
              key="import-preview"
              sourceId={importFlow.sourceId}
              secrets={importFlow.parseResult.secrets}
              mappings={importFlow.mappings}
              selectedKeys={importFlow.selectedKeys}
              errors={importFlow.parseResult.errors}
              syncConfig={importFlow.syncConfig}
              onToggleKey={importFlow.toggleKey}
              onSelectAll={importFlow.selectAll}
              onDeselectAll={importFlow.deselectAll}
              onImport={handleImportComplete}
              onSyncConfigChange={importFlow.setSyncConfig}
              onBack={importFlow.goBack}
            />
          )}
        </>
      ) : (
        <>
          {orch.phase === 'idle' && (
            <IdlePhase
              key="idle"
              instruction={orch.instruction}
              onInstructionChange={orch.setInstruction}
              onStart={() => orch.start()}
              onAutoSetup={handleAutoSetup}
              onImportFrom={() => setShowImport(true)}
              onKeyDown={handleKeyDown}
              showTemplates={showTemplates}
              onToggleTemplates={() => setShowTemplates((prev: boolean) => !prev)}
              templateSearch={templateSearch}
              onTemplateSearchChange={setTemplateSearch}
              templateConnectors={templateConnectors}
              expandedTemplateId={expandedTemplateId}
              onExpandTemplate={setExpandedTemplateId}
              onApplyTemplate={applyTemplate}
            />
          )}

          {orch.phase === 'analyzing' && (
            <AnalyzingPhase key="analyzing" outputLines={orch.outputLines} onCancel={orch.cancel} />
          )}

          {orch.phase === 'preview' && orch.contextValue && (
            <CredentialDesignProvider key="preview" value={orch.contextValue}>
              <PreviewPhase />
            </CredentialDesignProvider>
          )}

          {orch.phase === 'saving' && (
            <div
              key="saving"
              className="animate-fade-slide-in flex flex-col items-center justify-center py-12 gap-3"
            >
              <LoadingSpinner size="2xl" className="text-primary" />
              <p className="text-sm text-muted-foreground/90">Saving credential...</p>
            </div>
          )}

          {orch.phase === 'done' && (
            <DonePhase
              key="done"
              connectorLabel={orch.contextValue?.result.connector.label}
              registeredConnectorName={orch.registeredConnectorName}
              refinementCount={orch.refinementCount}
              onClose={handleClose}
              onViewCredential={orch.savedCredentialId ? handleViewCredential : undefined}
              onRefine={orch.startRefinement}
            />
          )}

          {orch.phase === 'error' && (
            <ErrorPhase
              key="error"
              error={orch.error}
              instruction={orch.instruction}
              onRetry={() => {
                const preserved = orch.instruction;
                orch.resetAll();
                orch.setInstruction(preserved);
              }}
              onStartOver={() => {
                orch.resetAll();
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
