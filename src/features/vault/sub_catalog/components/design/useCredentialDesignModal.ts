import { useState, useEffect } from 'react';
import { useCredentialDesignOrchestrator } from '@/features/vault/sub_catalog/components/design/useCredentialDesignOrchestrator';
import { useSystemStore } from "@/stores/systemStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useCredentialNav } from '@/features/vault/shared/hooks/CredentialNavContext';
import { useCredentialImport } from '@/features/vault/sub_credentials/components/import';
import type { CredentialDesignResult } from '@/hooks/design/credential/useCredentialDesign';
import type { CredentialDesignModalProps } from '@/features/vault/sub_catalog/components/design/credentialDesignModalTypes';
import { filterTemplateConnectors, buildTemplateResult } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';

export function useCredentialDesignModal({ open, initialInstruction, onClose, onComplete }: CredentialDesignModalProps) {
  const orch = useCredentialDesignOrchestrator();
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const { navigate } = useCredentialNav();

  // Template UI state
  const [showTemplates, setShowTemplates] = useState(false);
  const [templateSearch, setTemplateSearch] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  // Import flow state
  const [showImport, setShowImport] = useState(false);
  const importFlow = useCredentialImport();

  // Auto-credential state
  const [autoSetupPending, setAutoSetupPending] = useState(false);
  const [autoSetupResult, setAutoSetupResult] = useState<CredentialDesignResult | null>(null);

  const connectorDefinitions = useVaultStore((s) => s.connectorDefinitions);
  const fetchConnectorDefinitions = useVaultStore((s) => s.fetchConnectorDefinitions);

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      orch.resetAll();
      setShowTemplates(false);
      setTemplateSearch('');
      setExpandedTemplateId(null);
      setAutoSetupPending(false);
      setAutoSetupResult(null);
      setShowImport(false);
      importFlow.reset();
      fetchConnectorDefinitions();

      if (initialInstruction?.trim()) {
        orch.setInstruction(initialInstruction.trim());
        orch.start(initialInstruction.trim());
      }
    }
  }, [fetchConnectorDefinitions, importFlow, initialInstruction, open, orch]);

  // Capture auto-setup result when design completes
  const orchResult = orch.contextValue?.result;
  useEffect(() => {
    if (autoSetupPending && orch.phase === 'preview' && orchResult) {
      setAutoSetupResult(orchResult);
      setAutoSetupPending(false);
    }
  }, [autoSetupPending, orch.phase, orchResult]);

  const handleClose = () => {
    if (orch.phase === 'analyzing') orch.cancel();
    if (orch.phase === 'done') onComplete();
    setAutoSetupPending(false);
    setAutoSetupResult(null);
    onClose();
  };

  const handleViewCredential = () => {
    onComplete();
    onClose();
    setSidebarSection('credentials');
    navigate('credentials');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && orch.phase === 'idle') {
      e.preventDefault();
      orch.start();
    }
  };

  const handleAutoSetup = () => {
    if (!orch.instruction.trim()) return;
    setAutoSetupPending(true);
    orch.start();
  };

  // Template helpers
  const templateConnectors = filterTemplateConnectors(connectorDefinitions, templateSearch);

  const applyTemplate = (connectorName: string) => {
    const template = connectorDefinitions.find((c) => c.name === connectorName);
    if (!template) return;

    const result = buildTemplateResult(template);
    orch.loadTemplate(result);
    orch.setInstruction(`${template.label} credential`);
    orch.invalidateHealth();
    setShowTemplates(false);
  };

  const handleImportComplete = () => {
    const results = importFlow.buildResults();
    if (results.length === 0) return;
    const first = results[0]!;
    orch.loadTemplate(first);
    orch.setInstruction(`${first.connector.label} credential (imported)`);
    orch.invalidateHealth();
    setShowImport(false);
    importFlow.reset();
  };

  return {
    orch,
    handleClose,
    handleViewCredential,
    handleKeyDown,
    handleAutoSetup,
    showTemplates,
    setShowTemplates,
    templateSearch,
    setTemplateSearch,
    templateConnectors,
    expandedTemplateId,
    setExpandedTemplateId,
    applyTemplate,
    showImport,
    setShowImport,
    importFlow,
    handleImportComplete,
    autoSetupPending,
    autoSetupResult,
    setAutoSetupResult,
  };
}
