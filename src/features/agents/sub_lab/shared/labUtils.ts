// -- Shared primitives (single source of truth) --
export {
  TAG_STYLES,
  formatRelative,
  getSectionSummary,
  diffStrings,
} from './labPrimitives';

// -- Scoring utilities -- delegated to unified eval framework --
// These are re-exported from the single source of truth.
export {
  compositeScore,
  scoreColor,
  statusBadge,
  WEIGHT_TOOL_ACCURACY,
  WEIGHT_OUTPUT_QUALITY,
  WEIGHT_PROTOCOL_COMPLIANCE,
} from '@/lib/eval/evalFramework';
