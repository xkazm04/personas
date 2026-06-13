// Shared prop contract for the adoption "persona layout" surface and its
// directional prototype variants. The tab-switcher wrapper, the baseline, and
// each variant all consume this identical shape so consumers stay untouched.
import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';
import type { UseCaseErrorPolicy } from '@/lib/types/frontendTypes';
import type { TriggerSelection } from '../useCasePickerShared';
import type { EventSubscription } from '@/features/agents/shared/quickConfig/quickConfigTypes';
import type { ChannelSpecV2 } from '@/lib/bindings/ChannelSpecV2';

/** Loose template design-result shape (use_cases at top level, not AgentIR). */
export type TemplateDesignResult = Record<string, unknown>;

export interface PersonaLayoutAdoptionProps {
  designResult: TemplateDesignResult | null;
  templateName: string;
  selectedUseCaseIds: Set<string>;
  onToggleUseCase: (id: string) => void;
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  autoDetectedIds: Set<string>;
  blockedQuestionIds: Set<string>;
  filteredOptions?: Record<string, string[]>;
  dynamicOptions?: Record<string, DynamicOptionState>;
  onRetryDynamic?: (questionId: string) => void;
  onAddCredential?: (vaultCategory: string) => void;
  useCaseTitleById?: Record<string, string>;
  onContinue: () => void;
  onClose: () => void;
  errorPolicyByCap?: Record<string, UseCaseErrorPolicy>;
  onErrorPolicyChange?: (capabilityId: string, policy: UseCaseErrorPolicy) => void;
  triggerSelections: Record<string, TriggerSelection>;
  onTriggerChange: (capabilityId: string, sel: TriggerSelection) => void;
  eventSubsByCap: Record<string, EventSubscription[]>;
  onEventSubsChange: (capabilityId: string, subs: EventSubscription[]) => void;
  dimPolicyByCap: Record<string, { memory?: boolean; review?: boolean }>;
  onDimPolicyChange: (capabilityId: string, dim: 'memory' | 'review', on: boolean) => void;
  manualConnectors: string[];
  onManualConnectorsChange: (names: string[]) => void;
  connectorTables: Record<string, string[]>;
  onConnectorTablesChange: (tables: Record<string, string[]>) => void;
  notificationChannels: ChannelSpecV2[] | null;
  onNotificationChannelsChange: (channels: ChannelSpecV2[]) => void;
}

/** The hook consumes the full props shape. */
export type PersonaLayoutAdoptionModelProps = PersonaLayoutAdoptionProps;
