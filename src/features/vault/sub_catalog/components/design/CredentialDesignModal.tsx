import { X, Sparkles } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { computeSubtitle } from '@/features/vault/sub_catalog/components/design/credentialDesignModalTypes';
import type { CredentialDesignModalProps } from '@/features/vault/sub_catalog/components/design/credentialDesignModalTypes';
import { useCredentialDesignModal } from '@/features/vault/sub_catalog/components/design/useCredentialDesignModal';
import { CredentialDesignModalBody } from '@/features/vault/sub_catalog/components/design/CredentialDesignModalBody';
import { useTranslation } from '@/i18n/useTranslation';

export function CredentialDesignModal({ open, embedded = false, initialInstruction, onClose, onComplete }: CredentialDesignModalProps) {
  const { t } = useTranslation();
  const modal = useCredentialDesignModal({ open, embedded, initialInstruction, onClose, onComplete });

  if (!open) return null;

  const subtitle = computeSubtitle({
    showImport: modal.showImport,
    importPhase: modal.importFlow.phase,
    autoSetupResult: modal.autoSetupResult,
    autoSetupPending: modal.autoSetupPending,
    orchPhase: modal.orch.phase,
    refinementCount: modal.orch.refinementCount,
    connectorLabel: modal.autoSetupResult?.connector.label,
  });

  return (
    <BaseModal
      isOpen={open}
      onClose={modal.handleClose}
      titleId="credential-design-title"
      embedded={embedded}
      size="lg"
      panelClassName={embedded ? 'max-h-[80vh] overflow-y-auto bg-background border border-primary/15 rounded-2xl' : 'max-h-[min(90vh,960px)] overflow-y-auto bg-background border border-primary/15 rounded-2xl shadow-elevation-4'}
    >
      {/* Header */}
      <div data-testid="vault-design-container" className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/95 backdrop-blur-sm border-b border-primary/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-card bg-primary/10 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 id="credential-design-title" className="text-base font-semibold text-foreground">{t.vault.design_modal.title}</h2>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          icon={<X className="w-4 h-4" />}
          onClick={modal.handleClose}
          data-testid="vault-design-cancel"
          className="text-muted-foreground/90 hover:text-foreground hover:bg-secondary/60"
        />
      </div>

      {/* Body */}
      <CredentialDesignModalBody
        orch={modal.orch}
        showImport={modal.showImport}
        setShowImport={modal.setShowImport}
        importFlow={modal.importFlow}
        handleImportComplete={modal.handleImportComplete}
        autoSetupResult={modal.autoSetupResult}
        setAutoSetupResult={modal.setAutoSetupResult}
        autoSetupPending={modal.autoSetupPending}
        handleKeyDown={modal.handleKeyDown}
        handleAutoSetup={modal.handleAutoSetup}
        handleClose={modal.handleClose}
        handleViewCredential={modal.handleViewCredential}
        showTemplates={modal.showTemplates}
        setShowTemplates={modal.setShowTemplates}
        templateSearch={modal.templateSearch}
        setTemplateSearch={modal.setTemplateSearch}
        templateConnectors={modal.templateConnectors}
        expandedTemplateId={modal.expandedTemplateId}
        setExpandedTemplateId={modal.setExpandedTemplateId}
        applyTemplate={modal.applyTemplate}
        onComplete={onComplete}
      />
    </BaseModal>
  );
}
