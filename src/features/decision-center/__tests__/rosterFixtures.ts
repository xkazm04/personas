/** Fixture rows for the roster tests — one per source, overridable per test. */
import type { PendingApproval } from '@/api/companion';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { PendingCounts } from '@/lib/bindings/PendingCounts';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';

import type { DecisionItem } from '../model/decisionModel';

export function incidentRow(over: Partial<AuditIncident> = {}): AuditIncident {
  return {
    id: 'inc-1',
    sourceTable: 'tool_execution_audit_log',
    sourceId: 'src-1',
    dedupKey: 'tool_execution_audit_log:src-1',
    personaId: 'p-1',
    personaName: 'Scout',
    executionId: 'exec-1',
    severity: 'high',
    kind: 'tool_error',
    title: 'Tool call failed',
    detail: 'The fetch tool timed out three times.',
    status: 'open',
    acknowledgedAt: null,
    acknowledgedBy: null,
    resolvedAt: null,
    resolutionNote: null,
    continuedAt: null,
    createdAt: '2026-10-01T10:00:00Z',
    ...over,
  };
}

export function reportRow(over: Partial<PersonaReport> = {}): PersonaReport {
  return {
    id: 'rep-1',
    persona_id: 'p-1',
    execution_id: 'exec-1',
    title: 'Weekly digest',
    content: '# Digest\n\nAll good.',
    content_type: 'markdown',
    priority: 'normal',
    is_read: false,
    metadata: null,
    created_at: '2026-10-01T09:00:00Z',
    read_at: null,
    thread_id: null,
    use_case_id: null,
    ...over,
  };
}

export function councilSubject(over: Partial<CouncilSubjectState> = {}): CouncilSubjectState {
  return {
    id: 'cs-1',
    projectId: 'proj-1',
    kind: 'architecture',
    useCaseId: null,
    slug: 'event-bus',
    title: 'Event bus redesign',
    state: 'ready',
    tier: null,
    roundNo: 2,
    latestRunId: 'run-2',
    outcome: 'ready',
    overall: 0.82,
    coverage: 0.9,
    trustState: 'trusted',
    floorHits: 0,
    hardFailures: 0,
    drift: 'none',
    projectName: 'Personas',
    registrySubjects: [],
    runDir: null,
    finishedAt: '2026-10-02T08:00:00Z',
    decidedAt: null,
    rejectionReason: null,
    ...over,
  };
}

export function councilDetail(over: Partial<CouncilRunDetail> = {}): CouncilRunDetail {
  return {
    run: {
      id: 'run-2',
      subjectId: 'cs-1',
      roundNo: 2,
      supersedesRunId: 'run-1',
      rubricVersion: 'architecture-v1',
      trustState: 'trusted',
      outcome: 'ready',
      overall: 0.82,
      coverage: 0.9,
      headSha: 'abc',
      spanDigest: 'span',
      spannedPathsJson: '[]',
      hardFailuresJson: '[]',
      mustAddressJson: '[]',
      summary: 'The council found the design sound.',
      summaryIsSubjectFallback: false,
      runDir: '.personas/council/runs/run-2',
      startedAt: null,
      finishedAt: '2026-10-02T08:00:00Z',
      ingestedAt: '2026-10-02T08:01:00Z',
    },
    subject: {
      id: 'cs-1',
      projectId: 'proj-1',
      kind: 'architecture',
      useCaseId: null,
      slug: 'event-bus',
      title: 'Event bus redesign',
      drift: 'none',
      driftCheckedAt: null,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-10-02T00:00:00Z',
    },
    verdicts: [],
    sawDigest: 'digest-2',
    isLatest: true,
    decision: null,
    ...over,
  };
}

export function approvalRow(over: Partial<PendingApproval> = {}): PendingApproval {
  return {
    id: 'ap-1',
    action: 'write_fact',
    rationale: 'You told me your timezone.',
    paramsJson: '{"fact":"tz=CET"}',
    humanReviewId: null,
    createdAt: '2026-10-01T11:00:00Z',
    ...over,
  };
}

export function pendingCounts(over: Partial<PendingCounts> = {}): PendingCounts {
  return {
    goalAcceptance: 1,
    manualReviews: 2,
    ideas: 7,
    policyProposals: 1,
    promotionProposals: 1,
    openIncidents: 3,
    blockingIncidents: 1,
    unreadReports: 4,
    companionApprovals: 2,
    councilDecidable: 1,
    decisionTotal: 0,
    total: 0,
    ...over,
  };
}

/** A bare decision item — enough for ordering tests. */
export function item(over: Partial<DecisionItem> & Pick<DecisionItem, 'id' | 'kind'>): DecisionItem {
  return {
    sourceId: over.id,
    title: over.id,
    body: '',
    tags: [],
    facts: [],
    source: { label: 'x' },
    createdAt: '2026-10-01T10:00:00Z',
    weight: 50,
    branches: [],
    verdictLabels: { accept: 'a', reject: 'r', skip: 's' },
    ...over,
  };
}

/** The value a promise rejected with; fails the test if it resolved. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected the promise to reject');
}
