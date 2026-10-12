/**
 * Status marks for the Cockpit's decision widgets: kit Tone by what a severity MEANS.
 */
import type { Tone } from '@/features/shared/components/kit';

/** A manual review's free-form severity (critical/high/medium/low, or warning/info) as a kit Tone. */
export function reviewTone(severity: string | null | undefined): Tone {
  switch ((severity ?? '').toLowerCase()) {
    case 'critical':
    case 'high':
    case 'error':
      return 'error';
    case 'medium':
    case 'warning':
      return 'warning';
    case 'low':
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}
