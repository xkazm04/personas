/**
 * useDecisionSources — the four new row sources, each fetched only while its
 * chip is asked for.
 *
 * Incidents, unread reports, council subjects at the gate, and Athena's
 * pending approvals. Each goes through its existing `@/api` wrapper; nothing
 * here is a new command.
 *
 * Every source has three honest states, never two: rows, an error message
 * (the chip says it failed — an empty array would say nothing is waiting), or
 * not asked. A module-scoped warm slot per source lets a reopened surface paint
 * the last rows while it revalidates, the posture `useUnifiedTriage` takes for
 * its own four sources.
 */
import { useEffect, useState } from 'react';

import {
  companionListPendingApprovals,
  type PendingApproval,
} from '@/api/companion';
import { getCouncilRun, listCouncilSubjects } from '@/api/devTools/council';
import { listAuditIncidents } from '@/api/overview/incidents';
import { listUnreadReports } from '@/api/overview/reports';
import { decidable } from '@/features/companions/curator/council/councilRules';
import { mapWithConcurrency } from '@/lib/concurrency';
import { extractMessage, silentCatch } from '@/lib/silentCatch';
import type { AuditIncident } from '@/lib/bindings/AuditIncident';
import type { CouncilRunDetail } from '@/lib/bindings/CouncilRunDetail';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import type { PersonaReport } from '@/lib/bindings/PersonaReport';

import { OPEN_INCIDENT_STATUSES } from './decisionAdapters';

/** A working set, not an archive — same posture as the deck's caps. */
const INCIDENT_LIMIT = 100;
const REPORT_LIMIT = 50;
/** Run reads in flight at once — one per council at the gate, usually a handful. */
const COUNCIL_RUN_READS = 4;

export interface CouncilRow {
  subject: CouncilSubjectState;
  /** Null when the run read failed — the item still shows, undecidable. */
  detail: CouncilRunDetail | null;
}

export interface SourceState<T> {
  rows: T[];
  /** Why the last read failed (or partly failed). Null when it answered cleanly. */
  error: string | null;
  loading: boolean;
}

/** One fetch's answer. `error` set alongside rows = a partial answer. */
interface Fetched<T> {
  rows: T[];
  error?: string | null;
}

/** The last rows a source answered, surviving unmount. */
interface WarmSlot<T> {
  rows: T[] | null;
}

const warmIncidents: WarmSlot<AuditIncident> = { rows: null };
const warmReports: WarmSlot<PersonaReport> = { rows: null };
const warmCouncil: WarmSlot<CouncilRow> = { rows: null };
const warmApprovals: WarmSlot<PendingApproval> = { rows: null };

/** Test hatch: module state must not leak between tests. */
export function resetDecisionSourceCache(): void {
  warmIncidents.rows = null;
  warmReports.rows = null;
  warmCouncil.rows = null;
  warmApprovals.rows = null;
}

/** `fetcher` must be referentially stable — every caller passes a module function. */
function useSource<T>(
  name: string,
  slot: WarmSlot<T>,
  active: boolean,
  gen: number,
  fetcher: () => Promise<Fetched<T>>,
): SourceState<T> {
  const [state, setState] = useState<SourceState<T>>(() => ({
    rows: slot.rows ?? [],
    error: null,
    loading: false,
  }));
  useEffect(() => {
    if (!active) {
      // Switched off mid-read: the cleanup cancelled the landing, so nothing
      // else would ever clear the flag.
      setState((s) => (s.loading ? { ...s, loading: false } : s));
      return;
    }
    let cancelled = false;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    fetcher()
      .then(({ rows, error }) => {
        if (cancelled) return;
        slot.rows = rows;
        setState({ rows, error: error ?? null, loading: false });
      })
      .catch((err: unknown) => {
        silentCatch(`decisionCenter.source:${name}`)(err);
        if (cancelled) return;
        // Keep the last rows: a failed refresh is not an empty queue.
        setState((s) => ({ ...s, error: extractMessage(err), loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, [name, slot, active, gen, fetcher]);

  return state;
}

async function fetchIncidents(): Promise<Fetched<AuditIncident>> {
  const rows = await listAuditIncidents(
    {
      statuses: [...OPEN_INCIDENT_STATUSES],
      severities: null,
      source_tables: null,
      persona_id: null,
      since: null,
    },
    INCIDENT_LIMIT,
  );
  return { rows };
}

async function fetchReports(): Promise<Fetched<PersonaReport>> {
  return { rows: await listUnreadReports(undefined, REPORT_LIMIT) };
}

/**
 * Subjects at the gate, each with its latest run. Settled per subject: one
 * unreadable run must not take every other council off the strip, and the one
 * that failed still shows (it IS waiting) while the error says why it cannot
 * be decided from here.
 */
async function fetchCouncil(): Promise<Fetched<CouncilRow>> {
  const subjects = (await listCouncilSubjects()).filter(decidable);
  let error: string | null = null;
  const rows = await mapWithConcurrency(
    subjects,
    COUNCIL_RUN_READS,
    async (subject): Promise<CouncilRow> => {
      try {
        if (!subject.latestRunId) throw new Error(`Council ${subject.slug} has no run to decide`);
        return { subject, detail: await getCouncilRun(subject.latestRunId) };
      } catch (err) {
        silentCatch('decisionCenter.source:councilRun')(err);
        error = extractMessage(err);
        return { subject, detail: null };
      }
    },
  );
  return { rows, error };
}

async function fetchApprovals(): Promise<Fetched<PendingApproval>> {
  return { rows: await companionListPendingApprovals() };
}

export interface DecisionSourceFlags {
  incidents: boolean;
  reports: boolean;
  council: boolean;
  approvals: boolean;
}

export interface DecisionSources {
  incidents: SourceState<AuditIncident>;
  reports: SourceState<PersonaReport>;
  council: SourceState<CouncilRow>;
  approvals: SourceState<PendingApproval>;
}

/** Per-source generation counters: bumping one re-reads that source if it is active. */
export type DecisionSourceGens = Record<keyof DecisionSourceFlags, number>;

export function useDecisionSources(
  active: DecisionSourceFlags,
  gens: DecisionSourceGens,
): DecisionSources {
  return {
    incidents: useSource('incidents', warmIncidents, active.incidents, gens.incidents, fetchIncidents),
    reports: useSource('reports', warmReports, active.reports, gens.reports, fetchReports),
    council: useSource('council', warmCouncil, active.council, gens.council, fetchCouncil),
    approvals: useSource('approvals', warmApprovals, active.approvals, gens.approvals, fetchApprovals),
  };
}
