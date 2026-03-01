import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCredentialDesignOrchestrator } from '@/features/vault/hooks/useCredentialDesignOrchestrator';
import { usePersonaStore } from '@/stores/personaStore';
import type { CredentialDesignResult } from '@/hooks/design/useCredentialDesign';
import { CredentialDesignProvider } from '@/features/vault/components/credential-design/CredentialDesignContext';
import { IdlePhase } from '@/features/vault/components/credential-design/IdlePhase';
import { AnalyzingPhase } from '@/features/vault/components/credential-design/AnalyzingPhase';
import { PreviewPhase } from '@/features/vault/components/credential-design/PreviewPhase';
import { DonePhase } from '@/features/vault/components/credential-design/DonePhase';
import { ErrorPhase } from '@/features/vault/components/credential-design/ErrorPhase';

interface CredentialDesignModalProps {
  open: boolean;
  embedded?: boolean;
  initialInstruction?: string;
  onClose: () => void;
  onComplete: () => void;
}

export function CredentialDesignModal({ open, embedded = false, initialInstruction, onClose, onComplete }: CredentialDesignModalProps) {
  const orch = useCredentialDesignOrchestrator();
  const setSidebarSection = usePersonaStore((s) => s.setSidebarSection);
  const setCredentialView = usePersonaStore((s) => s.setCredentialView);

  // Template UI state (local to the modal)
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  const connectorDefinitions = usePersonaStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = usePersonaStore((s) => s.fetchConnectorDefinitions);

  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  // Focus trap: keep Tab within the modal
  const handleFocusTrap = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;

    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, []);

  // Reset everything when modal opens
  useEffect(() => {
    if (open) {
      orch.resetAll();
      setShowTemplates(false);
      setTemplateSearch('');
      setExpandedTemplateId(null);
      fetchConnectorDefinitions();

      if (initialInstruction?.trim()) {
        orch.setInstruction(initialInstruction.trim());
        orch.start(initialInstruction.trim());
      }
    }
  }, [open]);

  const handleClose = () => {
    if (orch.phase === 'analyzing') orch.cancel();
    if (orch.phase === 'done') onComplete();
    onClose();
  };

  const handleViewCredential = () => {
    onComplete();
    onClose();
    setSidebarSection('credentials');
    setCredentialView('credentials');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && orch.phase === 'idle') {
      e.preventDefault();
      orch.start();
    }
  };

  if (!open) return null;

  // ── Template helpers ────────────────────────────────────────────

  const templateConnectors = connectorDefinitions.filter((conn) => {
    const metadata = conn.metadata as Record<string, unknown> | null;
    if (!metadata) return false;
    if (metadata.template_enabled !== true) return false;

    const q = templateSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      conn.label.toLowerCase().includes(q)
      || conn.name.toLowerCase().includes(q)
      || conn.category.toLowerCase().includes(q)
    );
  });

  const applyTemplate = (connectorName: string) => {
    const template = connectorDefinitions.find((c) => c.name === connectorName);
    if (!template) return;

    const metadata = (template.metadata ?? {}) as Record<string, unknown>;
    const setupInstructions = typeof metadata.setup_instructions === 'string'
      ? metadata.setup_instructions
      : '';
    const summary = typeof metadata.summary === 'string'
      ? metadata.summary
      : `${template.label} connector`;

    const result: CredentialDesignResult = {
      match_existing: template.name,
      connector: {
        name: template.name,
        label: template.label,
        category: template.category,
        color: template.color,
        fields: template.fields.map((f) => ({
          key: f.key,
          label: f.label,
          type: f.type,
          required: f.required ?? false,
          placeholder: f.placeholder,
        })),
        healthcheck_config: template.healthcheck_config,
        services: template.services,
        events: template.events,
      },
      setup_instructions: setupInstructions,
      summary,
    };

    orch.loadTemplate(result);
    orch.setInstruction(`${template.label} credential`);
    orch.invalidateHealth();
    setShowTemplates(false);
  };

  // ── Render ──────────────────────────────────────────────────────

  return (
    <div className={embedded ? "relative" : "fixed inset-0 z-50 flex items-center justify-center"}>
      {/* Backdrop */}
      {!embedded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={handleClose}
        />
      )}

      {/* Modal */}
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="credential-design-title"
        onKeyDown={handleFocusTrap}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className={`relative w-full max-w-3xl ${embedded ? 'max-h-[80vh]' : 'max-h-[min(90vh,960px)]'} overflow-y-auto bg-background border border-primary/15 rounded-2xl ${embedded ? '' : 'shadow-2xl'}`}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 bg-background/95 backdrop-blur-sm border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 id="credential-design-title" className="text-sm font-semibold text-foreground">Design Credential</h2>
              <p className="text-sm text-muted-foreground/90">
                {orch.phase === 'idle' && 'Describe the service to connect'}
                {orch.phase === 'analyzing' && 'Analyzing your request...'}
                {orch.phase === 'preview' && 'Review and save'}
                {orch.phase === 'saving' && 'Saving...'}
                {orch.phase === 'done' && 'Credential created'}
                {orch.phase === 'error' && 'Something went wrong'}
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="p-2 rounded-lg hover:bg-secondary/60 text-muted-foreground/90 hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          <AnimatePresence mode="wait">
            {orch.phase === 'idle' && (
              <IdlePhase
                key="idle"
                instruction={orch.instruction}
                onInstructionChange={orch.setInstruction}
                onStart={() => orch.start()}
                onKeyDown={handleKeyDown}
                showTemplates={showTemplates}
                onToggleTemplates={() => setShowTemplates((prev) => !prev)}
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
              <motion.div
                key="saving"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12 gap-3"
              >
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground/90">Saving credential...</p>
              </motion.div>
            )}

            {orch.phase === 'done' && (
              <DonePhase
                key="done"
                connectorLabel={orch.contextValue?.result.connector.label}
                onClose={handleClose}
                onViewCredential={orch.savedCredentialId ? handleViewCredential : undefined}
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
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
