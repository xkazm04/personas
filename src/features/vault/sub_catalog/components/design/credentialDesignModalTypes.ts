export interface CredentialDesignModalProps {
  open: boolean;
  embedded?: boolean;
  initialInstruction?: string;
  onClose: () => void;
  onComplete: () => void;
}

export type DesignPhase = 'idle' | 'analyzing' | 'preview' | 'saving' | 'done' | 'error';

/**
 * Compute the subtitle displayed in the modal header based on current state.
 */
export function computeSubtitle(opts: {
  showImport: boolean;
  importPhase: string;
  autoSetupResult: unknown | null;
  autoSetupPending: boolean;
  orchPhase: string;
  refinementCount: number;
  connectorLabel?: string;
}): string {
  const { showImport, importPhase, autoSetupResult, autoSetupPending, orchPhase, refinementCount, connectorLabel } = opts;

  if (showImport) {
    if (importPhase === 'pick_source') return 'Import from external vault';
    if (importPhase === 'input') return 'Paste secrets data';
    if (importPhase === 'preview') return 'Review and select secrets';
    return 'Importing...';
  }

  if (autoSetupResult && connectorLabel) {
    return `Auto-Setup: ${connectorLabel}`;
  }

  if (autoSetupPending && orchPhase === 'analyzing') {
    return 'Designing credential for Auto-Setup...';
  }

  switch (orchPhase) {
    case 'idle': return 'Describe the service to connect';
    case 'analyzing': return 'Analyzing your request...';
    case 'preview': return 'Review and save';
    case 'saving': return 'Saving...';
    case 'done': return refinementCount > 0 ? `Credential updated (revision ${refinementCount})` : 'Credential created';
    case 'error': return 'Something went wrong';
    default: return '';
  }
}
