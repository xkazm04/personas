import type { N8nPersonaDraft, StreamingSection } from '@/api/templates/n8nTransform';
import type { CliRunPhase } from '@/hooks/execution/useCorrelatedCliStream';
import type { N8nImportAction, TransformQuestion, TransformSubPhase } from '../hooks/useN8nImportReducer';
import { normalizeDraftFromUnknown } from '../hooks/n8nTypes';

// ── Transform State Slice ──

export interface TransformState {
  // Questions
  questions: TransformQuestion[] | null;
  userAnswers: Record<string, string>;

  // Sub-phase tracking
  transformSubPhase: TransformSubPhase;

  // Transform lifecycle
  transforming: boolean;
  backgroundTransformId: string | null;
  snapshotEpoch: number;
  adjustmentRequest: string;
  transformPhase: CliRunPhase;
  transformLines: string[];

  // Streaming sections
  streamingSections: StreamingSection[];

  // Draft
  draft: N8nPersonaDraft | null;
  draftJson: string;
  draftJsonError: string | null;
}

export const INITIAL_TRANSFORM: TransformState = {
  questions: null,
  userAnswers: {},
  transformSubPhase: 'idle',
  transforming: false,
  backgroundTransformId: null,
  snapshotEpoch: 0,
  adjustmentRequest: '',
  transformPhase: 'idle',
  transformLines: [],
  streamingSections: [],
  draft: null,
  draftJson: '',
  draftJsonError: null,
};

// ── Reducer ──

export function transformReducer(
  slice: TransformState,
  action: N8nImportAction,
): TransformState {
  switch (action.type) {
    case 'SET_ADJUSTMENT':
      return { ...slice, adjustmentRequest: action.text };

    case 'QUESTIONS_GENERATED':
      return {
        ...slice,
        transforming: false,
        transformSubPhase: 'answering',
        questions: action.questions,
        userAnswers: action.questions.reduce<Record<string, string>>((acc, q) => {
          if (q.default) acc[q.id] = q.default;
          return acc;
        }, {}),
      };

    case 'QUESTIONS_FAILED':
      return {
        ...slice,
        transforming: false,
        transformSubPhase: 'answering',
        questions: null,
      };

    case 'ANSWER_UPDATED':
      return {
        ...slice,
        userAnswers: { ...slice.userAnswers, [action.questionId]: action.answer },
      };

    case 'TRANSFORM_STARTED':
      return {
        ...slice,
        transformSubPhase: action.subPhase ?? 'generating',
        transforming: true,
        backgroundTransformId: action.transformId,
        snapshotEpoch: slice.snapshotEpoch + 1,
        transformPhase: 'running',
        transformLines: [],
        streamingSections: [],
      };

    case 'TRANSFORM_LINES':
      return { ...slice, transformLines: action.lines };

    case 'TRANSFORM_PHASE':
      return { ...slice, transformPhase: action.phase };

    case 'TRANSFORM_SECTIONS':
      return { ...slice, streamingSections: action.sections };

    case 'TRANSFORM_COMPLETED': {
      if (!normalizeDraftFromUnknown(action.draft) || !action.draft.system_prompt?.trim()) {
        return {
          ...slice,
          transforming: false,
          transformSubPhase: 'failed',
          transformPhase: 'failed',
        };
      }
      return {
        ...slice,
        transforming: false,
        transformSubPhase: 'completed',
        transformPhase: 'completed',
        draft: action.draft,
        draftJson: JSON.stringify(action.draft, null, 2),
        draftJsonError: null,
      };
    }

    case 'TRANSFORM_FAILED':
      return {
        ...slice,
        transforming: false,
        transformSubPhase: 'failed',
        transformPhase: 'failed',
      };

    case 'TRANSFORM_CANCELLED':
      return {
        ...slice,
        transforming: false,
        transformSubPhase: 'idle',
        backgroundTransformId: null,
        transformPhase: 'idle',
        transformLines: [],
      };

    case 'DRAFT_UPDATED':
      return {
        ...slice,
        draft: action.draft,
        draftJson: JSON.stringify(action.draft, null, 2),
        draftJsonError: null,
      };

    case 'DRAFT_JSON_EDITED':
      return {
        ...slice,
        draftJson: action.json,
        draft: action.draft ?? slice.draft,
        draftJsonError: action.error,
      };

    case 'RESTORE_CONTEXT':
      return {
        ...slice,
        transformSubPhase: 'generating',
        backgroundTransformId: action.transformId,
        transforming: true,
        transformPhase: 'running',
      };

    case 'FILE_PARSED':
      return INITIAL_TRANSFORM;

    default:
      return slice;
  }
}
