// The reference fixture's ROUNDS, turned into the shape the round table reads.
//
// The fixture has always carried two complete runs for
// `multi-agent-orchestration` (`council-state.js` -> `runs`), with five
// members, their findings, their evidence and their technique proofs. Nothing
// read them: `useCouncilRun` went straight to `dev_tools_council_get_run`,
// which is a Tauri command, and in fixture mode there is no store behind it.
// So the round table opened with every member NOT MEASURED, the rose fully
// hatched, and "the members of this round have not been read yet" - on a run
// whose scores are sitting in the file the page had already loaded.
//
// That is the same boundary `normaliseFixtureTechnique` exists for: the
// fixture is snake_case and the product's bindings are camelCase, so the
// translation happens HERE, once, and nothing downstream can tell a fixture
// run from a real one.
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilVerdict } from '@/lib/bindings/CouncilVerdict';

/** One member's row, as `council-state.js` writes it. */
export interface FixtureDimension {
  dimension: string;
  kind: string;
  state: string;
  score: number | null;
  confidence: string;
  floor: number | null;
  floor_hit: boolean;
  advisory: boolean;
  unmeasured_reason: string | null;
  findings: unknown[];
  evidence: unknown[];
  techniques: unknown[];
  delta: string | null;
}

/** One round, as `council-state.js` writes it. */
export interface FixtureRun {
  run_id: string;
  subject: { kind: string; slug: string; title: string; summary?: string };
  rubric_version: string;
  round_no: number;
  supersedes_run_id: string | null;
  trust_state: string;
  receipt: { head_sha: string; spanned_paths: string[]; span_digest: string };
  hard_failures: unknown[];
  dimensions: FixtureDimension[];
  overall: number | null;
  coverage: number;
  outcome: string;
  must_address?: string[];
  summary?: string;
  started_at?: string | null;
  finished_at?: string | null;
}

function verdictOf(runId: string, d: FixtureDimension): CouncilVerdict {
  return {
    id: `${runId}:${d.dimension}`,
    runId,
    dimension: d.dimension,
    kind: d.kind,
    state: d.state,
    score: d.score ?? null,
    confidence: d.confidence,
    floor: d.floor ?? null,
    floorHit: d.floor_hit,
    advisory: d.advisory,
    // The document half, in the exact shape `parsePayload` re-checks. It is
    // re-parsed rather than passed through, because that parser is what the
    // real ingest door's blob also goes through - one reader for both.
    payloadJson: JSON.stringify({
      findings: d.findings,
      evidence: d.evidence,
      techniques: d.techniques,
      delta: d.delta,
      unmeasuredReason: d.unmeasured_reason,
    }),
  };
}

/**
 * One fixture round as a `CouncilRunDetail`.
 *
 * `subjectId` is the id the fixture's SUBJECT rows carry
 * (`${project}:${slug}`), so the detail and the queue row agree on identity.
 * `isLatest` is decided by the caller, which is the only place that knows
 * which run the subject points at.
 */
export function fixtureRunDetail(
  run: FixtureRun,
  subjectId: string,
  projectId: string,
  isLatest: boolean,
): CouncilRunDetail {
  return {
    run: {
      id: run.run_id,
      subjectId,
      roundNo: run.round_no,
      supersedesRunId: run.supersedes_run_id,
      rubricVersion: run.rubric_version,
      trustState: run.trust_state,
      outcome: run.outcome,
      overall: run.overall ?? null,
      coverage: run.coverage,
      headSha: run.receipt.head_sha,
      spanDigest: run.receipt.span_digest,
      spannedPathsJson: JSON.stringify(run.receipt.spanned_paths ?? []),
      hardFailuresJson: JSON.stringify(run.hard_failures ?? []),
      mustAddressJson: JSON.stringify(run.must_address ?? []),
      summary: run.summary ?? '',
      runDir: '',
      startedAt: run.started_at ?? null,
      finishedAt: run.finished_at ?? null,
      ingestedAt: run.finished_at ?? '',
    },
    subject: {
      id: subjectId,
      projectId,
      kind: run.subject.kind,
      useCaseId: null,
      slug: run.subject.slug,
      title: run.subject.title,
      drift: 'unknown',
      driftCheckedAt: null,
      createdAt: '',
      updatedAt: '',
    },
    verdicts: run.dimensions.map((d) => verdictOf(run.run_id, d)),
    sawDigest: run.receipt.span_digest,
    isLatest,
    // A fixture decision lives in the store, never on the run - the same
    // rule the overlay projection follows.
    decision: null,
  };
}
