import { X, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { MOTION_TIMING } from '@/features/templates/animationPresets';
import { computeSubtitle } from '@/features/vault/sub_design/credentialDesignModalTypes';
import type { CredentialDesignModalProps } from '@/features/vault/sub_design/credentialDesignModalTypes';
import { useCredentialDesignModal } from '@/features/vault/sub_design/useCredentialDesignModal';
import { CredentialDesignModalBody } from '@/features/vault/sub_design/CredentialDesignModalBody';

export function CredentialDesignModal({ open, embedded = false, initialInstruction, onClose, onComplete }: CredentialDesignModalProps) {
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
    <div className={embedded ? "relative" : "fixed inset-0 z-50 flex items-center justify-center"}>
      {/* Backdrop */}
      {!embedded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={MOTION_TIMING.FLOW}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={modal.handleClose}
        />
      )}

      {/* Modal */}
      <motion.div
        ref={modal.dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-design-title"
        tabIndex={-1}
        onKeyDown={modal.handleFocusTrap}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        transition={MOTION_TIMING.EASE}
        className={`relative w-full max-w-3xl ${embedded ? 'max-h-[80vh]' : 'max-h-[min(90vh,960px)]'} overflow-y-auto bg-background border border-primary/15 rounded-2xl ${embedded ? '' : 'shadow-2xl'}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/95 backdrop-blur-sm border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 id="credential-design-title" className="text-base font-semibold text-foreground">Design Credential</h2>
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            </div>
          </div>
          <button
            onClick={modal.handleClose}
            className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground transition-colors duration-snap"
          >
            <X className="w-4 h-4" />
          </button>
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
      </motion.div>
    </div>
  );
}
