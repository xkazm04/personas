import type { N8nPersonaDraft, TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';

export interface AdoptEntityError {
  entity_type: string;
  entity_name: string;
  error: string;
}

// -- Persistence --

export const ADOPT_CONTEXT_KEY = 'template-adopt-context-v1';

/** Max age for persisted context before it's considered stale (10 minutes) */
export const ADOPT_CONTEXT_MAX_AGE_MS = 10 * 60 * 1000;

export interface PersistedAdoptContext {
  adoptId: string;
  templateName: string;
  designResultJson: string;
  /** Timestamp when context was persisted (ms since epoch) */
  savedAt: number;
}

// -- Wizard Steps --

export type AdoptWizardStep = 'choose' | 'connect' | 'tune' | 'build' | 'create';

export const ADOPT_STEPS: readonly AdoptWizardStep[] = [
  'choose',
  'connect',
  'tune',
  'build',
  'create',
] as const;

export const ADOPT_STEP_META: Record<AdoptWizardStep, { label: string; index: number }> = {
  choose:  { label: 'Choose',  index: 0 },
  connect: { label: 'Connect', index: 1 },
  tune:    { label: 'Tune',    index: 2 },
  build:   { label: 'Build',   index: 3 },
  create:  { label: 'Create',  index: 4 },
};

// -- State --

export interface AdoptState {
  step: AdoptWizardStep;

  // Template context
  templateName: string;
  reviewId: string;
  designResult: AgentIR | null;
  designResultJson: string;

  // Entity selection (Choose step)
  selectedUseCaseIds: Set<string>;
  selectedToolIndices: Set<number>;
  selectedTriggerIndices: Set<number>;
  selectedConnectorNames: Set<string>;
  selectedChannelIndices: Set<number>;
  selectedEventIndices: Set<number>;

  // Template variables (Tune step)
  variableValues: Record<string, string>;

  // Trigger configs (Tune step)
  triggerConfigs: Record<number, Record<string, string>>;

  // AI questions (Tune step)
  questions: TransformQuestionResponse[] | null;
  userAnswers: Record<string, string>;
  questionGenerating: boolean;

  // Connector credential mapping (Connect step)
  connectorCredentialMap: Record<string, string>;
  inlineCredentialConnector: string | null;

  // Connector swaps (Connect step -- interchangeable connectors)
  /** Original connector name -> replacement connector name */
  connectorSwaps: Record<string, string>;

  // Persona preferences (Tune step)
  requireApproval: boolean;
  autoApproveSeverity: string;
  reviewTimeout: string;
  memoryEnabled: boolean;
  memoryScope: string;

  // Transform (Build step)
  transforming: boolean;
  backgroundAdoptId: string | null;
  adjustmentRequest: string;
  transformPhase: CliRunPhase;
  transformLines: string[];

  // Draft
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;

  // Create step
  confirming: boolean;
  created: boolean;
  partialEntityErrors: AdoptEntityError[];
  showEditInline: boolean;
  error: string | null;

  // Database setup (inline in Connect step)
  databaseMode: 'create' | 'existing';
  selectedTableNames: string[];
  databaseTable: string;
  databaseSchema: string;

  // Auto-adoption
  autoResolved: boolean;

  // Safety override -- user explicitly acknowledges critical scan findings
  safetyCriticalOverride: boolean;
}
