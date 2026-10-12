/**
 * decisionCopy — the translated strings the five new decision adapters need.
 *
 * Same contract as the triage deck's `TriageCopy`: adapters receive
 * already-translated copy and never call `t`, so the model stays i18n-free and
 * every adapter is a plain function in a test. The triage copy rides along
 * whole, because the new kinds share its verbs (approve, reject, skip) and its
 * fact labels (persona, raised, project) — a second "Approve" key would be a
 * second word for one gesture.
 *
 * {@link DEFAULT_DECISION_COPY} is the English fallback for callers outside a
 * component and for tests; `useDecisionCopy` (sibling file) is the binding to
 * the tree. React-free.
 */
import {
  DEFAULT_TRIAGE_COPY,
  type TriageCopy,
} from '@/features/agents/quick-answer/triage/triageAdapters';

/**
 * The shortest written reason a council rejection accepts.
 *
 * Mirrors the council gate's own floor (`CouncilGate.tsx`, `MIN_REASON = 12`):
 * a rejection is the one account the team gets of why a round failed the
 * human gate, and "no" is not an account. Exposed so the modal can enforce it
 * before the write, and enforced again by the dispatcher.
 */
export const COUNCIL_MIN_REASON = 12;

export interface DecisionCopy {
  /** The deck's copy — verbs and fact labels the new kinds share. */
  triage: TriageCopy;
  resolve: string;
  dismiss: string;
  startWork: string;
  startWorkHint: string;
  acknowledge: string;
  acknowledgeHint: string;
  openExecution: string;
  openExecutionHint: string;
  factStatus: string;
  factFirstSeen: string;
  factKind: string;
  sourceSystem: string;
  markRead: string;
  followUpChat: string;
  followUpChatHint: string;
  priorityCritical: string;
  priorityHigh: string;
  priorityNormal: string;
  priorityLow: string;
  /** A report with no title, named for the persona that wrote it. */
  reportUntitled: (personaName: string) => string;
  councilReasonTitle: string;
  /** Already carries the minimum length. */
  councilReasonPlaceholder: string;
  councilReasonBack: string;
  factRound: string;
  factOverall: string;
  factCoverage: string;
  /** A 0–1 ratio as a locale-aware whole percent. */
  percent: (ratio: number) => string;
  councilSummaryIsDescription: string;
  councilNoSummary: string;
  sourceAthena: string;
  lowRisk: string;
  factAction: string;
  /** Human label for an approval's action slug — `athenaLabels.actionLabel`. */
  actionLabel: (action: string) => string;
  chatDone: string;
  chatDismiss: string;
  chatYou: string;
  factLastMessage: string;
}

/** `fleet_send_input` → `Fleet send input` — the English fallback only. */
function humanizeSlug(slug: string): string {
  const words = slug.replace(/_/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : slug;
}

export const DEFAULT_DECISION_COPY: DecisionCopy = {
  triage: DEFAULT_TRIAGE_COPY,
  resolve: 'Resolve',
  dismiss: 'Dismiss',
  startWork: 'Start work',
  startWorkHint: 'Mark it in progress. It stays open until you resolve it.',
  acknowledge: 'Acknowledge',
  acknowledgeHint: 'Mark it seen without resolving it.',
  openExecution: 'Open execution',
  openExecutionHint: 'Read the run that raised this incident.',
  factStatus: 'Status',
  factFirstSeen: 'First seen',
  factKind: 'Kind',
  sourceSystem: 'System',
  markRead: 'Mark read',
  followUpChat: 'Follow up in chat',
  followUpChatHint: "Open this persona's chat to reply to the report.",
  priorityCritical: 'Critical',
  priorityHigh: 'High',
  priorityNormal: 'Normal',
  priorityLow: 'Low',
  reportUntitled: (name) => `Report from ${name}`,
  councilReasonTitle: 'Why reject this round?',
  councilReasonPlaceholder: `At least ${COUNCIL_MIN_REASON} characters. The team reads this.`,
  councilReasonBack: 'Back',
  factRound: 'Round',
  factOverall: 'Overall',
  factCoverage: 'Coverage',
  percent: (ratio) =>
    new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
  councilSummaryIsDescription:
    "This summary is the subject's own description, not the council's conclusion.",
  councilNoSummary: 'The council recorded no summary for this round.',
  sourceAthena: 'Athena',
  lowRisk: 'Low risk',
  factAction: 'Action',
  actionLabel: humanizeSlug,
  chatDone: 'Done',
  chatDismiss: 'Dismiss',
  chatYou: 'You',
  factLastMessage: 'Last message',
};
