import type { TransformQuestionResponse } from '@/api/templates/n8nTransform';
import type { DynamicOptionState } from '../useDynamicQuestionOptions';

export interface QuestionnaireFormProps {
  questions: TransformQuestionResponse[];
  userAnswers: Record<string, string>;
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
  /** Passes the vault category the user needs to connect a credential for. */
  onAddCredential?: (vaultCategory: string) => void;
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

export type QuestionnairePulse = { id: number; cat: string };
