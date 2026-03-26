// Re-export from canonical error explanation module.
// This file previously contained a duplicate copy of ERROR_PATTERNS / getErrorExplanation.
export {
  type ErrorAction,
  type ErrorSeverity,
  SEVERITY_ICONS,
  SEVERITY_TO_TOKEN,
  ERROR_PATTERNS,
  getErrorExplanation,
} from '@/lib/errors/errorExplanation';

export { hasNonEmptyJson } from '@/lib/utils/parseJson';
