import type { Translations } from '@/i18n/en';
import type { TeamDeliberation } from '@/lib/bindings/TeamDeliberation';
import { parseJsonOrDefault } from '@/lib/utils/parseJson';
import type { Lamp } from '../grid/prototype/entry-e/tone';
import { plainLine } from './runOutcome';

/** Deliberation status -> the catalog key that names it in the user's words
 *  (`deliberation.status_*`). The raw enum never renders. */
const STATUS_KEY = {
  open: 'status_open',
  converging: 'status_converging',
  resolved: 'status_resolved',
  escalated: 'status_escalated',
  awaiting_action: 'status_awaiting_action',
  action_running: 'status_action_running',
  tracking: 'status_tracking',
  paused: 'status_paused',
  aborted: 'status_aborted',
} as const;

export function deliberationStatusLabel(t: Translations, status: string): string {
  const key = STATUS_KEY[status as keyof typeof STATUS_KEY];
  return key ? t.deliberation[key] : status;
}

/** Lit while it talks (role-agent), amber when it waits on the operator, calm once it settles. */
export function deliberationLook(status: string): { win: string; lamp: Lamp } {
  if (status === 'escalated' || status === 'awaiting_action') return { win: 'ae-t-warn is-lit', lamp: { tone: 'warn', lit: true } };
  if (status === 'open' || status === 'converging' || status === 'action_running' || status === 'tracking') {
    return { win: 'ae-t-agent is-lit', lamp: { tone: 'run', lit: true } };
  }
  return { win: 'ae-t-agent', lamp: { tone: 'off', lit: false } };
}

/** The converged proposal, as the engine stores it on the row. */
export interface DeliberationProposal { title?: string; objective?: string; summary?: string }

/** What the team is leaning to: the converged proposal's title once there is one, else the newest turn's first line. */
export function deliberationLeaning(d: TeamDeliberation | undefined, newestTurn: string | null | undefined): string | null {
  const proposal = parseJsonOrDefault<DeliberationProposal | null>(d?.resolution, null);
  return proposal?.title ?? plainLine(newestTurn);
}
