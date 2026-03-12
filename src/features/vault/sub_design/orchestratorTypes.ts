import type { CredentialDesignPhase } from '@/hooks/design/credential/useCredentialDesign';
import type { CredentialDesignContextValue } from '@/features/vault/sub_design/CredentialDesignContext';

// -- Return type -----------------------------------------------------
export interface CredentialDesignOrchestrator {
  /** Ready-made context value for CredentialDesignProvider (null before result). */
  contextValue: CredentialDesignContextValue | null;

  // Phase machine
  phase: CredentialDesignPhase;
  outputLines: string[];
  error: string | null;
  savedCredentialId: string | null;
  registeredConnectorName: string | null;

  // Instruction / name
  instruction: string;
  setInstruction: (v: string) => void;
  credentialName: string;

  // Actions
  start: (override?: string) => void;
  cancel: () => void;
  resetAll: () => void;

  /** Additive refinement: restart design with context from previous result. */
  startRefinement: (refinementText: string) => void;
  /** How many refinement rounds have been applied in this session. */
  refinementCount: number;

  // Template support
  loadTemplate: (template: import('@/hooks/design/credential/useCredentialDesign').CredentialDesignResult) => void;
  invalidateHealth: () => void;
}
