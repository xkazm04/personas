/**
 * DEV fixture, part 1: the staged real record (.contest/arena/app-standup/data,
 * read from the operator's machine 2026-11-06) reduced to the wire shapes.
 * The away-log lines, project names, holds and history are real; Athena's
 * directions and agent changes are illustrative, each written from a real line
 * (B/1's model.js). Loaded only behind `import.meta.env.DEV` + the page toggle.
 */
import type { DirectionProposal } from '@/lib/bindings/DirectionProposal';
import type { StandupEvent } from '@/lib/bindings/StandupEvent';
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { TickState } from '../model/types';

/** The replayed moment: Fri 30 Oct 2026, the evening standup that amends that morning's rev 1. */
export const FIXTURE_DAY = Date.UTC(2026, 9, 30);
export const at = (h: number, m: number, dayOffset = 0) => FIXTURE_DAY + dayOffset * 86_400_000 + (h * 60 + m) * 60_000;

export const PROJECTS: Record<string, string> = {
  castlecontrol: 'CastleControl', paypal: 'paypal', overlord: 'overlord', kp: 'CandiDate', devsecops: 'devsecops',
  'gravitone-gcloud': 'gravitone-gcloud', ascent: 'ascent', pof: 'pof', 'garden-vr': 'garden-vr',
  'athena-portable': 'athena-portable', tracklight: 'tracklight', 'mage-arena-vr': 'mage-arena-vr',
};

export const PERSONAS: Record<string, string> = { 'p-mage': 'App Master mage-arena-vr', 'p-kpgate': 'KP Gate Steward' };

const ticks = (s: string): TickState[] => [...s].map((c) => (c === 'a' ? 'armed' : c === 'o' ? 'off' : 'none'));
/** Armed / off / not named in the 12 terminal standups 10-19..10-30. */
export const HISTORY: Record<string, TickState[]> = {
  castlecontrol: ticks('nnnnnnaaaaaa'), paypal: ticks('aannaaaoaaaa'), overlord: ticks('nnnnnnoaaoaa'),
  kp: ticks('aaaoaaaaaooo'), devsecops: ticks('aaaanoonnnnn'), 'gravitone-gcloud': ticks('annnnnnnnnnn'),
  ascent: ticks('nnnnnnnnnnnn'), pof: ticks('nnoonnnnnnnn'), 'garden-vr': ticks('nnnnnnnnoonn'),
  'mage-arena-vr': ticks('nnnnaaaaoooo'),
};

const p = (id: string, text: string, rationale: string, recommended = false): DirectionProposal => ({ id, text, rationale, recommended });

export const PROPOSALS: Record<string, DirectionProposal[]> = {
  castlecontrol: [
    p('cc-1', 'Shell round: the chambers treatment for the shell and the overview/keep pages', 'morning 10-30: "Not touched, as agreed: the shell ... could be the next round". 3 prototypes per surface, you pick, one builder at a time.', true),
    p('cc-2', 'Port frame round 3 to the stage', 'away log 11:06: "frame round 3 done (8 frames) ... Waiting on Michal\'s pick". Waits for your pick first, then 2 runs.'),
    p('cc-3', 'Freeze for the final: docs truth sync, Devpost rows, CI watch', 'say-castlecontrol 10-30: "Final is 11-02". No new UI before it; report only.'),
  ],
  paypal: [
    p('pp-1', 'Hold until your push, then re-point and unfreeze', 'morning 10-30, Needs you #1: the D1 history rewrite is ready and only you can run it.', true),
    p('pp-2', 'Plan the D2 refilm before R11 as one Report', 'morning 10-30: "D2 = refilm at the end (before R11, Nov 11)". No code.'),
    p('pp-3', 'Settle D3 (a live sandbox call) together first', 'PLAN 10-30 rulings: paypal.D3 undecided. Money parks for you.'),
  ],
  overlord: [
    p('ov-1', 'Next Malakor gap, at most 3 judged re-runs each', 'PLAN 10-29: "one Malakor gap (rows 18-29, <=3 judged re-runs)". No tournaments.', true),
    p('ov-2', 'Run the tournament from BATCH-1-SUMMARY.md', 'morning 10-30, Needs you #5: a tournament is spend and waits for your cap.'),
    p('ov-3', 'Rest tonight; its slot goes to dead-spot fill', 'morning 10-30: all overlord directions done.'),
  ],
  kp: [
    p('kp-1', 'Gate and push the 11 held commits, SSRF fix first', 'PLAN 10-30 off list: "11 unpushed commits incl SSRF fix". Names origin/main.', true),
    p('kp-2', 'Goal 3 role run: delivery 2 + retriggers to 0', 'PLAN 10-28: "goal 3 role run end to end". No push.'),
    p('kp-3', 'Rebuild the held two fresh on main', 'PLAN 10-23: "rebuild C2b bulk sheet fresh on main (b9a9e96f abandoned)".'),
  ],
  devsecops: [
    p('ds-1', 'Plan the ledgerline wif.tf H2 fix', 'PLAN 10-23: "infra/wif.tf H2 fix (never applied)". Applying infra parks for you.', true),
    p('ds-2', 'Lite councils on the remaining features', 'PLAN 10-19: "council lites on features". One Report.'),
  ],
  'gravitone-gcloud': [
    p('gv-1', 'Repair the probe data so the manifests commit again', 'PLAN 10-19 gravitone direction: frame-manifest binning and the sound-store probes.', true),
    p('gv-2', 'Re-plan milestone 1 against main', 'PLAN 10-19: "Plan milestone 1 C1-C7". No code.'),
  ],
  ascent: [
    p('as-1', 'Security + static sweep from its two scan charters', 'charters: Codebase security scan, static analysis sweep (rung 2, merge never).', true),
    p('as-2', 'One architecture review Report', 'charter: Codebase architecture review.'),
  ],
};

type E = [number, StandupEventKind, string, string?];
const ev = (prefix: string, rows: E[]): StandupEvent[] =>
  rows.map(([t, kind, summary, projectId = 'castlecontrol'], i) => ({ id: `${prefix}-${i}`, standupId: 'fx', at: t, kind, projectId, summary }));

/** The real CastleControl away log of 10-30 (80 of 271 lines, trimmed to their first clause). */
export const DAY_EVENTS: StandupEvent[] = ev('day', [
  [at(6, 30), 'push', 'gatehouse fix merged 39bf3b6, pushed c383e50..39bf3b6'],
  [at(6, 34), 'dispatch', 'dispatched lots, gatehouse, shell and maproom batches'],
  [at(6, 43), 'push', 'obs-02/04 merged 14d2e78, pushed'],
  [at(6, 44), 'ask_delegated', 'maproom batch blocked on a tabbable assertion; delegated the one-line update'],
  [at(7, 5), 'push', 'lots batch merged e9521db, pushed'],
  [at(7, 8), 'dispatch', 'dispatched beacons, gatehouse-2 and lots-2'],
  [at(7, 18), 'push', 'maproom batch merged 68a6147, pushed'],
  [at(7, 43), 'push', 'shell-10 merged 4de25a8, pushed'],
  [at(7, 57), 'sweep', 'sweep: shell-09 deciding; obs-05, shell-11 in flight'],
  [at(8, 17), 'ask_delegated', 'optimize backlog ready (63 findings); ruled the gate chain on one builder'],
  [at(8, 58), 'push', 'shell-B merged 2ebd543: all 12 challenge cards built, pushed'],
  [at(9, 1), 'dispatch', 'dispatched the optimize batch 2'],
  [at(9, 55), 'push', 'gate green on b77df13, pushed; holding for you'],
  [at(11, 6), 'ask_parked', 'frame round 3 done (8 frames); waiting on your pick'],
  [at(11, 8), 'dispatch', 'dispatched contract, seal hint, maproom-09, thread map, README'],
  [at(11, 59), 'push', 'contract merged 4591c60, pushed'],
  [at(12, 25), 'stop', 'operator stop: per-builder Rust targets exhausted the PC'],
  [at(12, 41), 'push', 'CI cache + lanes + README merged 99e9e47, pushed'],
  [at(13, 59), 'drift', 'verify red on 9e5c57e (Lots core proof), not pushed'],
  [at(14, 16), 'push', 'Lots core fix 7dffa07: e2e 110 passed, pushed'],
  [at(15, 56), 'push', 'proofs fixture fix af5e2f1, pushed'],
  [at(16, 23), 'ask_parked', 'queue paused for your shared-build-folder decision'],
  [at(7, 40), 'push', 'paypal D1 rewrite staged; push command ready', 'paypal'],
  [at(9, 12), 'push', 'overlord row-18 lead fixed, coverage 22.66% to 96.79%, pushed', 'overlord'],
]);

/** Illustrative away acts after the plan was armed at 17:20 (night of 10-30 -> 10-31). */
export const NIGHT_EVENTS: StandupEvent[] = ev('night', [
  [at(17, 36), 'dispatch', 'dispatched the shell round, prototypes 1/3'],
  [at(18, 20), 'push', 'shell prototypes merged, pushed origin main'],
  [at(19, 2), 'dispatch', 'dispatched the Malakor row-19 gap', 'overlord'],
  [at(19, 48), 'backfill', 'dead spot: queued a report-only scan on pof', 'pof'],
  [at(20, 30), 'ask_parked', 'tournament cap needed; parked for you', 'overlord'],
  [at(20, 41), 'push', 'kp: 11 commits gated + gitleaks clean, pushed origin/main', 'kp'],
  [at(21, 15), 'agent_created', 'created App Master CastleControl (origin standup-away)'],
  [at(23, 5), 'dispatch', 'dispatched the shell round 3/3'],
  [at(1, 40, 1), 'push', 'shell round 3/3 merged, pushed'],
  [at(3, 10, 1), 'sweep', 'sweep: 0 builders, queue empty', 'ascent'],
]);
