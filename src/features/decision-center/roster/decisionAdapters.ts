/**
 * decisionAdapters — four source rows in, one {@link DecisionItem} out.
 *
 * The kinds the triage deck never dealt: audit incidents, unread persona
 * reports, council subjects at the human gate, and Athena's companion
 * approvals. (Chat threads have their own module — they are DERIVED from two
 * slices rather than read from one row.) The six triage kinds need no adapter
 * here: `triageAdapters` already produces a structural `DecisionItem`.
 *
 * Same rules as `triageAdapters`: pure functions, copy injected, machine ids in
 * `payload` and never read back out of a fact row, and `weight` stated as an
 * explicit editorial judgement. Weight only orders WITHIN a tier
 * (`decisionOrder`), so each band below is placed against the triage bands of
 * the same tier: reviews 35–120, a halted build 90, promotions 78+, ideas
 * ~30–70, goals 45–60, policy 40–52.
 *
 * React-free and store-free.
 */
import { Activity, CheckCheck, MessageSquare, Play, ShieldCheck, Terminal } from 'lucide-react';

import type { PendingApproval } from '@/api/companion';
import type { ActionRisk } from '@/features/companions/athena/decision/actionRisk';
import type {
  TriageBranch,
  TriageFact,
  TriageLink,
  TriageTag,
  TriageTone,
} from '@/features/agents/quick-answer/triage/triageTypes';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';

import type { DecisionItem } from '../model/decisionModel';
import { COUNCIL_MIN_REASON, type DecisionCopy } from './decisionCopy';

const SEVERITY_TONE: Record<string, TriageTone> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
};

/**
 * Incident severity → weight. The review severity scale on purpose: a critical
 * incident and a critical review are the same urgency, and critical/high both
 * land in tier 1 beside held team steps and approvals.
 */
const INCIDENT_WEIGHT: Record<string, number> = {
  critical: 120,
  high: 95,
  medium: 60,
  low: 35,
};

const DEFAULT_INCIDENT_WEIGHT = 60;

/** Report priority → weight. Tier 3 only competes with chat (50). */
const REPORT_WEIGHT: Record<string, number> = {
  critical: 80,
  high: 65,
  normal: 40,
  low: 20,
};

const DEFAULT_REPORT_WEIGHT = 40;

/**
 * A council at the gate — a major feature or an architecture redesign whose
 * council came back clean and now waits on the ONE admitting act. Heavier than
 * any idea and a goal sign-off, lighter than a promotion (which expires) and a
 * halted build (which is stopped).
 */
const COUNCIL_WEIGHT = 70;

/**
 * Companion approvals are tier 1 by kind. Inside the tier: above a `high`
 * incident's floor band is wrong (incidents are things breaking), so just
 * under it — Athena is waiting with a plan, nothing is broken.
 */
const APPROVAL_WEIGHT = 85;

/** Incident statuses still awaiting a person. Mirrors `PendingCounts.openIncidents`. */
export const OPEN_INCIDENT_STATUSES: readonly string[] = ['open', 'acknowledged', 'in_progress'];

function lower(value: string | null | undefined, fallback: string): string {
  const v = (value ?? '').trim().toLowerCase();
  return v || fallback;
}

function humanize(token: string): string {
  return token.replace(/_/g, ' ');
}

/** Pretty JSON when the text IS JSON, else null — evidence renders monospace. */
function asJsonEvidence(text: string | null | undefined): string | null {
  const raw = (text ?? '').trim();
  if (!raw || (raw[0] !== '{' && raw[0] !== '[')) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Not JSON after all — it is prose, and the caller renders it as such.
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Incidents                                                                   */
/* -------------------------------------------------------------------------- */

export function incidentToDecision(incident: AuditIncident, copy: DecisionCopy): DecisionItem {
  const c = copy.triage;
  const severity = lower(incident.severity, 'medium');
  const status = lower(incident.status, 'open');
  const tone = SEVERITY_TONE[severity] ?? 'neutral';
  const evidence = asJsonEvidence(incident.detail);

  const tags: TriageTag[] = [
    { id: 'severity', label: severity, tone },
    { id: 'kind', label: humanize(incident.kind), tone: 'neutral', icon: Activity },
  ];

  const facts: TriageFact[] = [
    { id: 'severity', label: c.severity, value: severity, tone },
    { id: 'status', label: copy.factStatus, value: humanize(status) },
    { id: 'kind', label: copy.factKind, value: humanize(incident.kind) },
  ];
  if (incident.personaName) {
    facts.push({ id: 'persona', label: c.persona, value: incident.personaName });
  }
  facts.push({ id: 'first-seen', label: copy.factFirstSeen, value: incident.createdAt });

  // One branch per lifecycle step the backend's transition guard allows from
  // here (`audit_incidents::can_transition`) that is not already the spine:
  // resolve and dismiss ARE the spine, reopen is not a queue act.
  const branches: TriageBranch[] = [];
  if (status === 'open') {
    branches.push({
      id: 'acknowledge',
      label: copy.acknowledge,
      hint: copy.acknowledgeHint,
      tone: 'neutral',
      icon: CheckCheck,
    });
  }
  if (status !== 'in_progress') {
    branches.push({
      id: 'start',
      label: copy.startWork,
      hint: copy.startWorkHint,
      tone: 'accent',
      icon: Play,
    });
  }

  const links: TriageLink[] = incident.executionId
    ? [{ id: 'run', label: copy.openExecution, hint: copy.openExecutionHint, icon: Terminal }]
    : [];

  return {
    id: `incident:${incident.id}`,
    sourceId: incident.id,
    kind: 'incident',
    severity,
    personaId: incident.personaId,
    title: incident.title,
    body: evidence ? c.noDescription : (incident.detail ?? '').trim() || c.noDescription,
    evidence,
    tags,
    facts,
    links: links.length > 0 ? links : undefined,
    source: {
      label: incident.personaName || copy.sourceSystem,
      sublabel: humanize(incident.sourceTable),
    },
    createdAt: incident.createdAt,
    weight: INCIDENT_WEIGHT[severity] ?? DEFAULT_INCIDENT_WEIGHT,
    branches,
    verdictLabels: { accept: copy.resolve, reject: copy.dismiss, skip: c.skip },
    payload: {
      executionId: incident.executionId ?? undefined,
      personaId: incident.personaId ?? undefined,
      sourceTable: incident.sourceTable,
      seenStatus: status,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

/** Who wrote the report, resolved by the caller from the persona roster. */
export interface ReportAuthor {
  name: string;
  color?: string | null;
  icon?: string | null;
}

export function reportToDecision(
  report: PersonaReport,
  author: ReportAuthor | null,
  copy: DecisionCopy,
): DecisionItem {
  const c = copy.triage;
  const priority = lower(report.priority, 'normal');
  const priorityLabel: Record<string, string> = {
    critical: copy.priorityCritical,
    high: copy.priorityHigh,
    normal: copy.priorityNormal,
    low: copy.priorityLow,
  };
  const priorityTone: TriageTone =
    priority === 'critical' ? 'danger' : priority === 'high' ? 'warning' : 'neutral';
  const isHtml = lower(report.content_type, 'markdown') === 'html';
  const name = author?.name || report.persona_id;

  return {
    id: `report:${report.id}`,
    sourceId: report.id,
    kind: 'report',
    personaId: report.persona_id,
    personaIcon: author?.icon ?? null,
    title: (report.title ?? '').trim() || copy.reportUntitled(name),
    // The document IS the case. HTML never doubles as a markdown body — it is
    // only ever rendered sanitized in a script-free frame.
    body: isHtml ? '' : report.content,
    document: {
      format: isHtml ? 'html' : 'markdown',
      content: report.content,
      mediaScope: report.id,
    },
    tags: [{ id: 'priority', label: priorityLabel[priority] ?? priority, tone: priorityTone }],
    facts: [
      { id: 'persona', label: c.persona, value: name },
      { id: 'priority', label: c.priority, value: priorityLabel[priority] ?? priority },
      { id: 'raised', label: c.raised, value: report.created_at },
    ],
    source: { label: name, color: author?.color ?? null },
    createdAt: report.created_at,
    weight: REPORT_WEIGHT[priority] ?? DEFAULT_REPORT_WEIGHT,
    branches: [
      {
        id: 'chat',
        label: copy.followUpChat,
        hint: copy.followUpChatHint,
        tone: 'accent',
        icon: MessageSquare,
      },
    ],
    // Both verdicts retire the report the only way a report retires — it is
    // read. "Dismiss" is "read, and nothing to follow up"; the branch is the
    // follow-up.
    verdictLabels: { accept: copy.markRead, reject: copy.dismiss, skip: c.skip },
    payload: {
      personaId: report.persona_id,
      executionId: report.execution_id ?? undefined,
      threadId: report.thread_id ?? undefined,
      useCaseId: report.use_case_id ?? undefined,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Council                                                                     */
/* -------------------------------------------------------------------------- */

/** Null when unmeasured — never a 0%. */
function percentOf(ratio: number | null | undefined, copy: DecisionCopy): string | null {
  return typeof ratio === 'number' && Number.isFinite(ratio) ? copy.percent(ratio) : null;
}

/**
 * A council subject at the human gate.
 *
 * `detail` is the latest run as `getCouncilRun` returns it — the summary to
 * read and the `sawDigest` the decision must hand back. Null when that read
 * failed: the item is still dealt (the subject IS waiting), but without a
 * digest no decision can be written, and the dispatcher says so instead of
 * deciding blind.
 *
 * The document is the run's summary markdown for now; a full-report read
 * replaces it later. `mediaScope` is the run id the media resolver keys on.
 */
export function councilToDecision(
  subject: CouncilSubjectState,
  detail: CouncilRunDetail | null,
  copy: DecisionCopy,
): DecisionItem {
  const c = copy.triage;
  const run = detail?.run ?? null;
  const runId = run?.id ?? subject.latestRunId;
  const facts: TriageFact[] = [{ id: 'project', label: c.project, value: subject.projectName }];
  if (subject.roundNo !== null) {
    facts.push({ id: 'round', label: copy.factRound, value: String(subject.roundNo) });
  }
  const overall = percentOf(subject.overall, copy);
  if (overall) facts.push({ id: 'overall', label: copy.factOverall, value: overall });
  const coverage = percentOf(subject.coverage, copy);
  if (coverage) facts.push({ id: 'coverage', label: copy.factCoverage, value: coverage });

  const tags: TriageTag[] = [
    { id: 'kind', label: humanize(subject.kind), tone: 'accent', icon: ShieldCheck },
  ];
  if (subject.tier) tags.push({ id: 'tier', label: subject.tier, tone: 'neutral' });

  return {
    id: `council:${subject.id}`,
    sourceId: subject.id,
    kind: 'council',
    title: subject.title,
    body: '',
    reasoning: run?.summaryIsSubjectFallback ? copy.councilSummaryIsDescription : undefined,
    document: {
      format: 'markdown',
      content: run?.summary?.trim() || copy.councilNoSummary,
      mediaScope: runId,
    },
    tags,
    facts,
    source: { label: subject.projectName },
    createdAt: subject.finishedAt ?? run?.finishedAt ?? run?.ingestedAt ?? '',
    weight: COUNCIL_WEIGHT,
    branches: [],
    // A council rejection without a written reason is refused by the door, so
    // the prompt is free-text only and its escape is "back", not "skip it".
    reasonPrompts: [
      {
        on: 'reject',
        title: copy.councilReasonTitle,
        options: [],
        skipLabel: copy.councilReasonBack,
        freeText: true,
        placeholder: copy.councilReasonPlaceholder,
      },
    ],
    verdictLabels: { accept: c.approve, reject: c.reject, skip: c.skip },
    payload: {
      projectId: subject.projectId,
      runId: runId ?? undefined,
      sawDigest: detail?.sawDigest ?? undefined,
      isLatest: detail ? String(detail.isLatest) : undefined,
      reasonMin: String(COUNCIL_MIN_REASON),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Companion approvals                                                         */
/* -------------------------------------------------------------------------- */

function prettyParams(json: string): string | null {
  const raw = json.trim();
  if (!raw || raw === '{}' || raw === 'null') return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    // Unparseable params still deserve to be seen exactly as sent.
    return raw;
  }
}

/**
 * One of Athena's pending approvals. `risk` comes from
 * `athena/decision/actionRisk` (the classification a test pins against the
 * backend catalog) and is injected so this module stays catalog-free.
 */
export function approvalToDecision(
  approval: PendingApproval,
  risk: ActionRisk,
  copy: DecisionCopy,
): DecisionItem {
  const c = copy.triage;
  const label = copy.actionLabel(approval.action);
  const tags: TriageTag[] =
    risk === 'low' ? [{ id: 'risk', label: copy.lowRisk, tone: 'success' }] : [];

  return {
    id: `approval:${approval.id}`,
    sourceId: approval.id,
    kind: 'approval',
    title: label,
    body: approval.rationale.trim() || c.noDescription,
    evidence: prettyParams(approval.paramsJson),
    tags,
    facts: [
      { id: 'action', label: copy.factAction, value: approval.action },
      { id: 'raised', label: c.raised, value: approval.createdAt },
    ],
    source: { label: copy.sourceAthena },
    createdAt: approval.createdAt,
    weight: APPROVAL_WEIGHT,
    branches: [],
    verdictLabels: { accept: c.approve, reject: c.reject, skip: c.skip },
    payload: {
      action: approval.action,
      humanReviewId: approval.humanReviewId ?? undefined,
      risk,
    },
  };
}
