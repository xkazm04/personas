// @vitest-environment node
/**
 * The lens-scan cards (spark one-control, WP3): each kind appears and
 * disappears on its `LensScanProduct` threshold, one card per product per
 * kind; a store error yields no card; the cards can never be decided from
 * the peek row, take the `lens` shape in the deck, and have no write route.
 */
import { describe, expect, it } from 'vitest';

import { canAcceptFromRow, canFinishFromRow, canRejectFromRow, peekKeyAction } from '../../hub/peekKeys';
import { buildLaneCounts } from '../../lanes/laneModel';
import { routeDecisionItem, type DecisionPorts } from '../../roster/decisionDispatch';
import { shapeOf } from '../../deck/shapes/cardShape';
import { lensToDecisions } from '../lensAdapters';
import { lensCardKinds, lensDealsLane, lensKindsOf } from '../lensKinds';
import type { ReleaseComposition } from '../releaseComposition';
import { lensCopy, product } from './lensFixtures';

const NONE = new Map<string, ReleaseComposition>();
const cards = (p = product(), comps = NONE) => lensToDecisions([p], comps, lensCopy());

describe('lens card thresholds', () => {
  it('holds no card when nothing waits', () => {
    expect(lensKindsOf(product({ counts: { declined: 4, accepted: 2, released: 7, executing: 1 } }))).toEqual([]);
  });

  it('build: proposed items, or approved items not yet built', () => {
    expect(lensKindsOf(product({ counts: { proposed: 1 } }))).toEqual(['build']);
    expect(lensKindsOf(product({ counts: { approved: 2 } }))).toEqual(['build']);
    expect(lensKindsOf(product({ counts: { proposed: 0, approved: 0, executing: 3 } }))).toEqual([]);
  });

  it('evidence: built items awaiting triage', () => {
    expect(lensKindsOf(product({ awaitingTriage: 1 }))).toEqual(['evidence']);
    expect(lensKindsOf(product({ awaitingTriage: 0 }))).toEqual([]);
  });

  it('release: a release waiting on the operator, or accepted items no release holds', () => {
    expect(lensKindsOf(product({ openRelease: { id: 'rel-1.2.0', status: 'pr-open' } }))).toEqual(['release']);
    expect(lensKindsOf(product({ openRelease: { id: 'rel-1.2.0', status: 'merged' } }))).toEqual(['release']);
    expect(lensKindsOf(product({ unreleasedAccepted: 3 }))).toEqual(['release']);
    // A release bp is still building waits on bp, not on the operator.
    expect(lensKindsOf(product({ openRelease: { id: 'rel-1.2.0', status: 'building' } }))).toEqual([]);
    expect(lensKindsOf(product({ openRelease: { id: 'rel-1.2.0', status: 'draft' } }))).toEqual([]);
  });

  it('one card per product per kind, all three at once', () => {
    const p = product({ counts: { proposed: 2, approved: 1 }, awaitingTriage: 4, unreleasedAccepted: 1 });
    expect(cards(p).map((c) => c.id)).toEqual(['build:proj-teapot', 'evidence:proj-teapot', 'release:proj-teapot']);
    const q = product({ projectId: 'proj-kiln', name: 'Kiln Labs', counts: { proposed: 1 } });
    expect(lensToDecisions([p, q], NONE, lensCopy()).map((c) => c.id)).toEqual([
      'build:proj-teapot', 'evidence:proj-teapot', 'release:proj-teapot', 'build:proj-kiln',
    ]);
  });

  it('a product whose store errored yields no card', () => {
    const p = product({ counts: { proposed: 5 }, awaitingTriage: 2, error: 'database disk image is malformed' });
    expect(lensKindsOf(p)).toEqual([]);
    expect(cards(p)).toEqual([]);
  });
});

describe('lens card words', () => {
  it('build: the counts in the body and facts; Open is the one gesture', () => {
    const [c] = cards(product({ counts: { proposed: 3, approved: 1, executing: 2 } }));
    expect(c!.title).toBe('Teapot Works: build queue');
    expect(c!.body).toContain('3 proposals wait for approve or decline.');
    expect(c!.body).toContain('1 approved item is not built yet.');
    expect(c!.facts.map((f) => [f.id, f.value])).toEqual([['proposed', '3'], ['approved', '1'], ['building', '2'], ['store', 'v3']]);
    expect(c!.payload).toMatchObject({ projectId: 'proj-teapot', lensKind: 'build', cost: 'Opens on Enter' });
    expect(c!.branches).toEqual([]);
  });

  it('evidence: the triage count', () => {
    const [c] = cards(product({ awaitingTriage: 1 }));
    expect(c!.kind).toBe('evidence');
    expect(c!.body).toContain('1 built item waits for triage');
    expect(c!.verdictLabels).toMatchObject({ accept: 'Accept', reject: 'Rework' });
  });

  it('release: the open release names its version from its id; a suggestion waits for the store', () => {
    const [open] = cards(product({ openRelease: { id: 'rel-2.4.0', status: 'pr-open' } }));
    expect(open!.title).toBe('Teapot Works: release 2.4.0');
    expect(open!.body).toContain('Release 2.4.0 has an open pull request.');

    const p = product({ unreleasedAccepted: 2 });
    const [pending] = cards(p);
    expect(pending!.title).toBe('Teapot Works: next release');
    expect(pending!.facts.find((f) => f.id === 'items')?.value).toBe('2');

    const comp: ReleaseComposition = {
      version: '0.5.1', from: 'v0.5.0', bump: 'patch', items: [], notes: null, open: null, waiting: false, unreleasedCount: 2,
    };
    const [suggested] = cards(p, new Map([['proj-teapot', comp]]));
    expect(suggested!.title).toBe('Teapot Works: release 0.5.1');
    expect(suggested!.body).toContain('Suggested version: 0.5.1.');
  });
});

describe('lens cards never write from the card', () => {
  const all = cards(product({ counts: { proposed: 1 }, awaitingTriage: 1, unreleasedAccepted: 1 }));

  it('A and R on the peek row open the card instead of deciding', () => {
    for (const c of all) {
      expect(canAcceptFromRow(c)).toBe(false);
      expect(canRejectFromRow(c)).toBe(false);
      expect(canFinishFromRow(c)).toBe(false);
      expect(peekKeyAction('a', { armed: false, item: c })).toEqual({ type: 'open' });
      expect(peekKeyAction('r', { armed: false, item: c })).toEqual({ type: 'open' });
      expect(peekKeyAction('Enter', { armed: false, item: c })).toEqual({ type: 'open' });
    }
  });

  it('takes the lens shape in the deck, routed or not', () => {
    for (const c of all) {
      expect(shapeOf(c, null)).toBe('lens');
      expect(shapeOf(c, { lane: 'breach', clause: 'valve', charterId: 'c1' })).toBe('lens');
    }
  });

  it('has no write route: a verdict that reached the dispatcher is refused', async () => {
    const ports = {} as DecisionPorts;
    for (const c of all) {
      await expect(routeDecisionItem({ item: c, verdict: 'accept' }, ports)).rejects.toThrow(/No route/);
      await expect(routeDecisionItem({ item: c, verdict: 'reject' }, ports)).rejects.toThrow(/No route/);
    }
  });
});

describe('lens cards in the lanes', () => {
  it('build counts in Breach, evidence and release in Accept', () => {
    const products = [
      product({ counts: { proposed: 1 }, awaitingTriage: 1, unreleasedAccepted: 1 }),
      product({ projectId: 'proj-kiln', counts: { approved: 1 } }),
    ];
    const counts = buildLaneCounts({
      snapshot: { items: [], charters: [], failedSources: [], generatedAt: '2026-10-15T10:00:00Z' },
      snapshotFailed: false,
      questions: 0,
      chat: { n: 0, failed: false },
      lens: { kinds: lensCardKinds(products), failed: false, source: 'lens_scan_products' },
    });
    expect(counts.breach.n).toBe(2);
    expect(counts.accept.n).toBe(2);
    expect(counts.sign.n).toBe(0);
    expect(counts.breach.lamp).toBe('warning');
  });

  it('a failed products read fails Breach and Accept by name, and nothing else', () => {
    const counts = buildLaneCounts({
      snapshot: { items: [], charters: [], failedSources: [], generatedAt: '2026-10-15T10:00:00Z' },
      snapshotFailed: false,
      questions: 0,
      chat: { n: 0, failed: false },
      lens: { kinds: [], failed: true, source: 'lens_scan_products' },
    });
    expect(counts.breach.failedSources).toEqual(['lens_scan_products']);
    expect(counts.accept.failed).toBe(true);
    expect(counts.sign.failed).toBe(false);
    expect(counts.talk.failed).toBe(false);
  });

  it('the lanes that deal lens cards load them', () => {
    expect(lensDealsLane('breach')).toBe(true);
    expect(lensDealsLane('accept')).toBe(true);
    expect(lensDealsLane('sign')).toBe(false);
    expect(lensDealsLane('talk')).toBe(false);
    expect(lensDealsLane(null)).toBe(false);
  });
});
