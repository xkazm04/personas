import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { AgentIR } from '@/lib/types/designTypes';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';

export interface QuestionnaireFormProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
  /** Parsed template payload — feeds the centerpiece sigil's base presence. */
  designResult?: AgentIR | null;
  /** Question IDs auto-answered from the credential vault. */
  autoDetectedIds?: Set<string>;
  /** Question IDs blocked because no vault credential exists for the category. */
  blockedQuestionIds?: Set<string>;
  /** Vault-narrowed option lists per question ID. Applied when 2+ credentials match. */
  filteredOptions?: Record<string, string[]>;
  /**
   * Per-question state from `useDynamicQuestionOptions` — populated for any
   * question whose template carries a `dynamic_source`.
   */
  dynamicOptions?: Record<string, DynamicOptionState>;
  onRetryDynamic?: (questionId: string) => void;
  /**
   * Opens the quick-add credential flow for the thing the user needs to connect.
   *
   * The argument is EITHER vocabulary — a real vault category (`messaging`,
   * `email`, `image_generation`) when `question.vault_category` is set, or a
   * `dynamic_source.service_type` (`gmail`, `notion`, …) when it is not. Those
   * are separate vocabularies and the renderers legitimately pass both
   * (`QuestionnaireFormGridParts.tsx:129-130,:174`).
   *
   * Resolving them is the HANDLER's job, in one place:
   * `ChronologyAdoptionView.handleAddCredentialForCategory` (`:1282-1291`) maps
   * a service_type to its category tag before the picker filters the catalog —
   * without that step `connectorsInCategory()` returns nothing and the modal
   * looks broken. Any new handler bound to this prop owes the same resolution;
   * the parameter is not a promise that only categories arrive.
   */
  onAddCredential?: (vaultCategoryOrServiceType: string) => void;
  onAnswerUpdated: (questionId: string, answer: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  templateName?: string;
  /** Map of use-case id → human title for rendering "Applies to" lines. */
  useCaseTitleById?: Record<string, string>;
}

export interface QuestionnaireCategoryProgress {
  answered: number;
  total: number;
  pct: number;
}

export interface QuestionnaireNormalizedOption {
  value: string;
  label: string;
  sublabel: string | null;
}

export type QuestionnaireThreadState = 'answered' | 'current' | 'pending' | 'blocked';
