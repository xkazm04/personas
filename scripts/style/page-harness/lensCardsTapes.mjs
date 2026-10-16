// Synthetic tape for the lens-scan cards in the live Decision Deck and the sheets they open
// (lensCardsSurfaces.tsx, spark one-control WP3). Fixture CODE, no personal data: the products are
// made up, and the store snapshot is bp's SYNTHETIC Kettle sample (the blueprint's own fixture,
// src/features/decision-center/blueprint/fixture/kettle.scan.json). No row of a live store is here.
//
// On top of the deck's own tape (decisionDeckTapes.mjs) this answers: an EMPTY lanes snapshot (so
// the lane decks deal only the frontend-derived lens cards), four lens-scan products (Kettle holds
// all three cards, Teapot Works a Build card), Kettle's snapshot, and bp's base URL setting, which
// points at a harness host the surface answers itself (up, or refused for the bp-down shot).
import { readFileSync } from 'node:fs';

import { decisionDeckTapes } from './decisionDeckTapes.mjs';

const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));

export function lensCardsTapes({ RECORDED_AT }) {
  const T0 = Date.parse(RECORDED_AT);
  const ago = (minutes) => new Date(T0 - minutes * 60_000).toISOString();
  const deck = decisionDeckTapes({ RECORDED_AT, PERSONAS: [] }).builders['decision-center/deck']();
  const scan = read('../../../src/features/decision-center/blueprint/fixture/kettle.scan.json');
  // the Kettle sample's own map and events, so a blueprint opened from the picker renders the real drawing
  const structure = read('../../../src/features/decision-center/blueprint/fixture/kettle.structure.json');
  const events = readFileSync(new URL('../../../src/features/decision-center/blueprint/fixture/kettle.events.jsonl', import.meta.url), 'utf8');

  const products = [
    {
      projectId: 'fixture-kettle', name: 'Kettle', root: 'C:/sample/kettle', storeVersion: 3,
      counts: { proposed: 8, approved: 3, executing: 2, done: 7, failed: 2, rework: 1, declined: 1, accepted: 2 },
      awaitingTriage: 4, unreleasedAccepted: 1, openRelease: { id: 'rel-0.4.0', status: 'building' }, lastRunAt: ago(42),
      hasMap: true, mapVersion: 3, features: 133, lenses: 8, measuredFacets: 1240, hasEvents: true,
    },
    {
      projectId: 'fixture-teapot', name: 'Teapot Works', root: 'C:/sample/teapot-works', storeVersion: 2,
      counts: { proposed: 2, declined: 1 }, awaitingTriage: 0, unreleasedAccepted: 0, lastRunAt: ago(180),
      hasMap: true, mapVersion: 2, features: 14, lenses: 3, measuredFacets: 0, hasEvents: false,
    },
    // picker-only rows (nothing in them waits, so they deal no card): one measured, one with no map
    {
      projectId: 'fixture-sugar', name: 'Sugar Bowl', root: 'C:/sample/sugar-bowl', storeVersion: 3,
      counts: {}, awaitingTriage: 0, unreleasedAccepted: 0, lastRunAt: ago(60 * 26),
      hasMap: true, mapVersion: 3, features: 22, lenses: 4, measuredFacets: 96, hasEvents: false,
    },
    {
      projectId: 'fixture-jug', name: 'Milk Jug', root: 'C:/sample/milk-jug', storeVersion: 3,
      counts: {}, awaitingTriage: 0, unreleasedAccepted: 0,
      hasMap: false, features: 0, lenses: 0, measuredFacets: 0, hasEvents: false,
    },
  ];

  const calls = [
    { cmd: 'decision_lanes_snapshot', response: { items: [], charters: [], failedSources: [], generatedAt: RECORDED_AT } },
    { cmd: 'mandate_list', response: [] },
    { cmd: 'lens_scan_products', response: products },
    { cmd: 'lens_scan_snapshot', response: { structure, events, scan, storeVersion: 3 } },
    { cmd: 'get_app_setting', response: 'http://bp.harness.test' },
    { cmd: 'list_manual_reviews_page', response: { rows: [], nextCursor: null, hasMore: false } },
    { cmd: 'dev_tools_undispatched_ideas', response: [] },
    { cmd: 'get_persona_summaries', response: [] },
    { cmd: 'policy_tuning_list', response: [] },
    { cmd: 'evolution_list_promotion_proposals', response: [] },
    { cmd: 'dev_tools_list_pending_acceptance', response: [] },
  ];

  return {
    builders: {
      'decision-center/lens-cards': () => ({
        ...deck,
        module: 'decision-center/lens-cards',
        note: `${deck.note} Plus the lens-scan cards: an empty lanes snapshot, four synthetic products (Kettle with Build, Evidence and Release cards; Teapot Works with a Build card; Sugar Bowl and Milk Jug with no card, for the picker's readiness levels), the Kettle sample store, and bp's URL setting on a harness host.`,
        calls: [...deck.calls.filter((c) => !calls.some((x) => x.cmd === c.cmd)), ...calls],
      }),
    },
  };
}
