/**
 * The triage instruments' colour vocabulary, by meaning (doctrine section 4),
 * in the shape module 1 set (`home/sub_releases/releaseTones.ts`): one chip
 * recipe and one text class per tone, every class over a theme variable so
 * light themes get real styling without a repair selector.
 *
 * Statuses say how something went: an accepted rule and a cleared finding are
 * success, a rejected rule and a regression are error. The theme's own primary
 * stays `primary` wherever it was already primary (Gate 1): it is identity, not
 * a status, and the `highlight` role is a different hue in light themes.
 */
export type TriageTone = 'success' | 'info' | 'warning' | 'error' | 'neutral';

export const TONE_TEXT: Record<TriageTone, string> = {
  success: 'text-status-success',
  info: 'text-status-info',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-foreground',
};

export const TONE_CHIP: Record<TriageTone, string> = {
  success: 'border-status-success/30 bg-status-success/10 text-status-success',
  info: 'border-status-info/30 bg-status-info/10 text-status-info',
  warning: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  error: 'border-status-error/30 bg-status-error/10 text-status-error',
  neutral: 'border-primary/10 bg-secondary/40 text-foreground',
};

/** A rule's action is the verdict it produces: accept is success, reject is error. */
export function ruleActionTone(action: string): TriageTone {
  return action === 'accept' ? 'success' : 'error';
}

/** The soft primary action the rules panel always used (PrimarySoftButton). */
export const PRIMARY_SOFT = 'border-primary/20 bg-primary/10 text-primary hover:bg-primary/20';
