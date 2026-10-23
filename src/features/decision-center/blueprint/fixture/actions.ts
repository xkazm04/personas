// A static BlueprintActions over the fixture. It applies the state table locally and answers in the store's own
// shapes (`DecideResult`, `TriageResult`, `StartResult`, `CommitDiff`), skipped reasons included, so the dock console
// and the tests exercise exactly what a live source would print. Nothing here is a store: the answers are modelled
// on lens-scan's store.mjs (compare-and-set on the item's current status; a missing id is `not-found`; `triage` check
// for check, WP4b). The side reads answer synthetic commits (commits.ts) and synthetic screens (shots.ts).
import type { CommitDiff, Pack, Proposal, ProposalStatus, ScanSnapshot, TriageResult } from '@/lib/lensScan/wire';
import type { BlueprintActions, BlueprintData, DecideDecision, DecideResult, StartRequest, StartResult, TriageDecisionInput } from '../source';
import { MOVES } from '../model/states';
import { sampleCommit } from './commits';
import { sampleShot } from './shots';

const BY = 'operator:fixture';
const NOW = '2026-10-15T12:00:00Z';

export interface FixtureActions extends BlueprintActions {
  /** Test and harness helper: the build the last `start` opened finishes; its items become `done` (or `failed`). */
  settleBuilds(outcome?: 'done' | 'failed'): void;
  /** The rows as they stand. */
  snapshot(): ScanSnapshot;
}

export function createFixtureActions(initial: BlueprintData): FixtureActions {
  let data: BlueprintData = initial;
  let seq = 0;
  const put = (rows: Proposal[]) => { data = { ...data, scan: { ...data.scan, proposals: rows } }; };
  const patch = (id: string, change: Partial<Proposal>) => put(data.scan.proposals.map((p) => (p.id === id ? { ...p, ...change, updated_at: NOW } : p)));
  const find = (id: string) => data.scan.proposals.find((p) => p.id === id);
  // the wire omits NULL columns: a cleared column is a missing key, never `undefined`
  const replace = (id: string, row: Proposal) => put(data.scan.proposals.map((p) => (p.id === id ? (Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as unknown as Proposal) : p)));
  /** Compare-and-set packs `from` -> `to`; answers the ids that moved. */
  const setPacks = (ids: string[], from: Pack['status'], to: Pack['status']): string[] => {
    const moved = ids.filter((k) => data.scan.packs.some((x) => x.id === k && x.status === from));
    data = { ...data, scan: { ...data.scan, packs: data.scan.packs.map((x) => (moved.includes(x.id) ? { ...x, status: to, updated_at: NOW } : x)) } };
    return moved;
  };

  return {
    async decide(ids: string[], decision: DecideDecision, note?: string): Promise<DecideResult> {
      const to: ProposalStatus = decision === 'approve' ? 'approved' : 'declined';
      const decided: string[] = [], skipped: DecideResult['skipped'] = [];
      for (const id of new Set(ids)) {
        const p = find(id);
        if (!p) { skipped.push({ id, status: 'not-found' }); continue; }
        if (!MOVES[decision].from.includes(p.status)) { skipped.push({ id, status: p.status }); continue; }
        patch(id, { status: to, decided_by: BY, decided_at: NOW, ...(note ? { decision_note: note } : {}) });
        decided.push(id);
      }
      return { decision: to === 'approved' ? 'approved' : 'declined', by: BY, decided, skipped };
    },

    async triage(ids: string[], decision: TriageDecisionInput, note?: string): Promise<TriageResult> {
      // store.mjs `triage`, check for check: the move's from-set, note-required, no-prior-status, in-release (a release
      // past draft), rebuilt, pack-closed; then the packs the move settles (open -> triaged) or reopens
      const move = MOVES[decision], reopen = decision === 'reopen', text = note?.trim() ? note : undefined;
      const to = { accept: 'accepted', rework: 'rework', descope: 'descoped', reopen: 'reopened' } as const;
      const triaged: string[] = [], skipped: TriageResult['skipped'] = [], touched: string[] = [], reopened: string[] = [];
      for (const id of new Set(ids)) {
        const p = find(id);
        if (!p) { skipped.push({ id, status: 'not-found' }); continue; }
        if (!move.from.includes(p.status)) { skipped.push({ id, status: p.status }); continue; }
        if (decision === 'accept' && p.status === 'failed' && !text) { skipped.push({ id, status: p.status, reason: 'note-required' }); continue; }
        if (reopen && !p.triaged_from) { skipped.push({ id, status: p.status, reason: 'no-prior-status' }); continue; }
        const leaves = decision !== 'accept' && !!p.release_id;
        if (leaves && data.scan.releases.find((r) => r.id === p.release_id)?.status !== 'draft') { skipped.push({ id, status: p.status, reason: 'in-release' }); continue; }
        if (reopen && p.status === 'rework' && data.scan.proposals.some((x) => x.attempt_of === id)) { skipped.push({ id, status: p.status, reason: 'rebuilt' }); continue; }
        if (reopen && data.scan.packs.find((k) => k.id === p.pack_id)?.status === 'closed') { skipped.push({ id, status: p.status, reason: 'pack-closed' }); continue; }
        const target: ProposalStatus = reopen ? p.triaged_from ?? p.status : to[decision as Exclude<TriageDecisionInput, 'reopen'>];
        // a move records the status it left (the undo's target); the undo clears it, so undo is one step deep
        replace(id, { ...p, status: target, triaged_by: BY, triaged_at: NOW, updated_at: NOW, triage_note: reopen ? undefined : text, triaged_from: reopen ? undefined : p.status, release_id: leaves ? undefined : p.release_id });
        triaged.push(id);
        if (p.pack_id && reopen && (target === 'done' || target === 'failed')) reopened.push(p.pack_id);
        else if (p.pack_id) touched.push(p.pack_id);
      }
      const back = setPacks([...new Set(reopened)], 'triaged', 'open');
      const settled = [...new Set(touched)].filter((k) => !data.scan.proposals.some((x) => x.pack_id === k && ['executing', 'done', 'failed'].includes(x.status)));
      const out: TriageResult = { decision: to[decision], by: BY, triaged, skipped, packs_triaged: setPacks(settled, 'open', 'triaged') };
      return reopen ? { ...out, packs_reopened: back } : out;
    },

    async start(req: StartRequest): Promise<StartResult> {
      const label = `personas:fixture-${(++seq).toString(16).padStart(4, '0')}`;
      if (req.action === 'execute') for (const id of req.ids ?? []) { const p = find(id); if (p && p.status === 'approved' && p.lens === req.lens) patch(id, { status: 'executing' }); }
      const parts = ['node', 'lens-scan/scripts/drive.mjs', req.action, '--lens', req.lens];
      if (req.ids?.length) parts.push('--ids', req.ids.join(','));
      if (req.features?.length) parts.push('--features', req.features.join(','));
      if (req.standard) parts.push('--standard', req.standard);
      parts.push('--root', data.product.root);
      return { label, command: parts.join(' '), pid: 4000 + seq };
    },

    async commitDiff(sha: string): Promise<CommitDiff> { return sampleCommit(sha, data.scan.proposals); },

    async shotUrl(path: string): Promise<string> { return sampleShot(path); },

    async refresh(): Promise<BlueprintData> { return data; },

    settleBuilds(outcome: 'done' | 'failed' = 'done') {
      put(data.scan.proposals.map((p) => (p.status === 'executing' ? { ...p, status: outcome, updated_at: NOW } : p)));
    },
    snapshot: () => data.scan,
  };
}
