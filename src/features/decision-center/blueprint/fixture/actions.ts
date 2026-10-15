// A static BlueprintActions over the fixture. It applies the state table locally and answers in the store's own
// shapes (`DecideResult`, `TriageResult`, `StartResult`, `CommitDiff`), skipped reasons included, so the dock console
// and the tests exercise exactly what a live source would print. Nothing here is a store: the answers are modelled
// on lens-scan's store.mjs (compare-and-set on the item's current status; a missing id is `not-found`).
import type { CommitDiff, Proposal, ProposalStatus, ScanSnapshot, TriageResult } from '@/lib/lensScan/wire';
import type { BlueprintActions, BlueprintData, DecideDecision, DecideResult, StartRequest, StartResult, TriageDecisionInput } from '../source';
import { MOVES } from '../model/states';

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
      const move = MOVES[decision];
      const decided = { accept: 'accepted', rework: 'rework', descope: 'descoped', reopen: 'reopened' } as const;
      const triaged: string[] = [], skipped: TriageResult['skipped'] = [];
      for (const id of new Set(ids)) {
        const p = find(id);
        if (!p) { skipped.push({ id, status: 'not-found' }); continue; }
        if (!move.from.includes(p.status)) { skipped.push({ id, status: p.status }); continue; }
        if (decision === 'accept' && p.status === 'failed' && !note) { skipped.push({ id, status: p.status, reason: 'note-required' }); continue; }
        if (decision !== 'accept' && p.release_id) { skipped.push({ id, status: p.status, reason: 'in-release' }); continue; }
        if (decision === 'reopen' && !p.triaged_from) { skipped.push({ id, status: p.status, reason: 'no-prior-status' }); continue; }
        patch(id, { status: decision === 'reopen' ? p.triaged_from! : (decided[decision] as ProposalStatus), triaged_from: p.status, triaged_by: BY, triaged_at: NOW, ...(note ? { triage_note: note } : {}) });
        triaged.push(id);
      }
      return { decision: decided[decision], by: BY, triaged, skipped, packs_triaged: [] };
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

    async commitDiff(sha: string): Promise<CommitDiff> {
      const patchText = ['--- a/src/sample.ts', '+++ b/src/sample.ts', '@@ -1,2 +1,3 @@', ' export const sample = true;', '+export const fixture = true;', ' '].join('\n');
      return { sha, message: `sample change\n\nLens-Scan: fixture`, stat: ' src/sample.ts | 1 +\n 1 file changed, 1 insertion(+)', files: [{ path: 'src/sample.ts', add: 1, del: 0 }], patch: patchText, lines: 6, truncated: false };
    },

    async shotUrl(path: string): Promise<string> {
      const label = path.split('/').pop() ?? path;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" fill="slategray"/><text x="16" y="96" fill="white" font-family="sans-serif" font-size="14">${label.replace(/[<&>"]/g, '')}</text></svg>`;
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },

    async refresh(): Promise<BlueprintData> { return data; },

    settleBuilds(outcome: 'done' | 'failed' = 'done') {
      put(data.scan.proposals.map((p) => (p.status === 'executing' ? { ...p, status: outcome, updated_at: NOW } : p)));
    },
    snapshot: () => data.scan,
  };
}
