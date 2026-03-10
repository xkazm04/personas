import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';
import type { AgentIR, ConnectorReadinessStatus } from '@/lib/types/designTypes';
import type { CredentialMetadata, ConnectorDefinition } from '@/lib/types/types';
import type { UseCaseFlow } from '@/lib/types/frontendTypes';
import type { TemplateVerification } from '@/lib/types/templateTypes';
import type { ScanResult } from '@/lib/templates/personaSafetyScanner';
import type { RequiredConnector } from '../steps/connect/ConnectStep';
import type { AdoptWizardStep, AdoptState } from '../hooks/useAdoptReducer';
import type { useAdoptReducer } from '../hooks/useAdoptReducer';
import type { getAdoptionRequirements } from '../templateVariables';

export interface AdoptionWizardContextType {
  // Core state & actions
  state: AdoptState;
  wizard: ReturnType<typeof useAdoptReducer>;

  // Derived data
  useCaseFlows: UseCaseFlow[];
  readinessStatuses: ConnectorReadinessStatus[];
  adoptionRequirements: ReturnType<typeof getAdoptionRequirements>;
  requiredConnectors: RequiredConnector[];
  completedSteps: Set<AdoptWizardStep>;
  liveCredentials: CredentialMetadata[];
  designResult: AgentIR | null;
  connectorDefinitions: ConnectorDefinition[];

  /** Template origin verification and sandbox policy */
  verification: TemplateVerification;

  /** Safety scan results for the current draft (null if no draft) */
  safetyScan: ScanResult | null;

  /** Whether template uses a database connector */
  hasDatabaseConnector: boolean;

  // Async transform orchestration
  currentAdoptId: string | null;
  isRestoring: boolean;
  startTransform: () => Promise<void>;
  cancelTransform: () => Promise<void>;
  continueTransform: () => Promise<void>;
  confirmSave: () => Promise<void>;
  cleanupAll: () => Promise<void>;

  // Credential actions (manual-selection-aware wrappers)
  setConnectorCredential: (connectorName: string, credentialId: string) => void;
  clearConnectorCredential: (connectorName: string) => void;

  // Convenience helpers
  handleNext: () => void;
  handleCredentialCreated: () => void;
  handleSkipQuestions: () => void;
  updateDraft: (updater: (d: N8nPersonaDraft) => N8nPersonaDraft) => void;

  // Auto-adoption
  quickAdopt: () => void;
  enterFullWizard: () => void;

  // Draft recovery
  saveDraftToStore: () => void;
  discardDraft: () => void;
}
