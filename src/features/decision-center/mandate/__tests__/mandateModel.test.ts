/**
 * The mandate-lane card model (mandate-lanes WP5), React-free:
 *  - envelope: grants are read off the draft (merge != never, a cap above 0),
 *    review.info is flagged, scopes keep the document order;
 *  - breachPlan: amend means widen / let merges land / raise the cap only on a
 *    signed, active mandate, and decides the item itself otherwise;
 *  - claimModel: the KPI check never invents a tick; the audit sample is
 *    seeded, bounded and skips envelope acts;
 *  - mandateWrites: sign carries the envelope, drop retires, amend / suspend
 *    reach their doors, and anything else is not a mandate write.
 */
import { describe, expect, it, vi } from 'vitest';

import { en } from '@/i18n/en';

import { item } from '../../__tests__/rosterFixtures';
import type { MonitorCopy } from '../../deck/deckMeta';
import { breachPlan, clauseLine, denyPrompt } from '../breachPlan';
import { kpiCheck, sampleActs } from '../claimModel';
import { draftFrom, grantsFinalReviews, grantsOf, toggleScope } from '../envelope';
import { mandateToDecision } from '../mandateItem';
import { isMandateWrite, writeMandateVerdict, type MandateDoors } from '../mandateWrites';
import { act, mandate } from './mandateFixtures';

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor as MonitorCopy;
const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

describe('envelope', () => {
  it('grants merge for any policy but never, and spend only for a cap above zero', () => {
    const d = draftFrom(mandate().envelope);
    expect(grantsOf(d)).toEqual([]);
    expect(grantsOf({ ...d, mergePolicy: 'gate-green' })).toEqual(['merge']);
    expect(grantsOf({ ...d, budgetMonthlyUsd: 0 })).toEqual([]);
    expect(grantsOf({ ...d, mergePolicy: 'gate-green+council-ready', budgetMonthlyUsd: 40 })).toEqual(['merge', 'spend']);
  });

  it('flags info reviews and keeps scopes in document order', () => {
    let d = draftFrom(mandate().envelope);
    d = toggleScope(d, 'review.info');
    d = toggleScope(d, 'idea.accept');
    expect(d.decideScopes).toEqual(['idea.accept', 'review.info']);
    expect(grantsFinalReviews(d)).toBe(true);
    expect(grantsFinalReviews(toggleScope(d, 'review.info'))).toBe(false);
  });
});

describe('breachPlan', () => {
  const idea = item({ id: 'idea:1', kind: 'idea' });
  const review = item({ id: 'review:1', kind: 'review' });

  it('widens by the scope that releases the kind, on a signed active mandate only', () => {
    expect(breachPlan(idea, 'scope', mandate()).amend).toEqual({ kind: 'scope', scope: 'idea.accept' });
    expect(breachPlan(idea, 'scope', mandate({ envelope: { envelopeVersion: 0 } })).amend).toEqual({ kind: 'item' });
    expect(breachPlan(idea, 'scope', mandate({ status: 'suspended' })).amend).toEqual({ kind: 'item' });
    expect(breachPlan(review, 'scope', mandate()).amend).toEqual({ kind: 'item' });
    expect(breachPlan(idea, 'scope', null)).toMatchObject({ amend: { kind: 'item' }, canSuspend: false });
  });

  it('arms the merge and spend amends, and only those', () => {
    expect(breachPlan(review, 'merge', mandate())).toMatchObject({ amend: { kind: 'merge', from: 'never', to: 'gate-green' }, arms: 'merge' });
    expect(breachPlan(review, 'spend', mandate({ envelope: { budgetMonthlyUsd: 20 } }))).toMatchObject({ amend: { kind: 'spend', from: 20 }, arms: 'spend' });
    expect(breachPlan(review, 'risk', mandate())).toMatchObject({ amend: { kind: 'item' }, arms: null, canSuspend: true });
    expect(breachPlan(item({ id: 'approval:1', kind: 'approval', irreversible: 'merge' }), 'unsigned', mandate()).arms).toBe('merge');
  });

  it('says every clause in words and offers clause reasons that write durable English', () => {
    for (const c of ['stop', 'valve', 'risk', 'merge', 'spend', 'scope', 'unsigned', 'none'] as const) expect(clauseLine(m, c)).toBeTruthy();
    const p = denyPrompt(m, 'merge');
    expect(p.options.map((o) => o.value)).toEqual(['I review merges on this mandate myself', 'The branch needs a second look']);
    expect(denyPrompt(m, 'unsigned').options[0]!.value).toBe('Not for this mandate');
  });
});

describe('claimModel', () => {
  it('reads the KPI check off the goal facts, and says when there is none', () => {
    const goal = (facts: Parameters<typeof item>[0]['facts']) => item({ id: 'goal:1', kind: 'goal', facts });
    expect(kpiCheck(goal([]), m, tx)).toEqual({ tone: 'neutral', text: m.ml_claim_kpi_none });
    expect(kpiCheck(goal([{ id: 'kpi', label: 'KPI', value: 'Activation' }]), m, tx).text).toBe('Activation: no reading yet');
    expect(kpiCheck(goal([{ id: 'kpi', label: 'KPI', value: 'Activation' }, { id: 'progress', label: 'P', value: '34 → 50 %', tone: 'warning' }]), m, tx))
      .toEqual({ tone: 'warning', text: 'Activation is not at its target yet (34 → 50 %)' });
  });

  it('samples up to three decision acts, the same ones for the same card', () => {
    const acts = [act('a1'), act('a2'), act('a3'), act('a4'), act('a5'), act('env', { itemKind: 'mandate' }), act('rv', { itemKind: 'act.revert' })];
    const s = sampleActs(acts, 'goal:1');
    expect(s).toHaveLength(3);
    expect(s.every((a) => a.itemKind === 'report')).toBe(true);
    expect(sampleActs(acts, 'goal:1').map((a) => a.id)).toEqual(s.map((a) => a.id));
    expect(sampleActs([act('only')], 'goal:1').map((a) => a.id)).toEqual(['only']);
  });
});

describe('mandateWrites', () => {
  const doors = (): MandateDoors => ({ sign: vi.fn(async () => ({})), drop: vi.fn(async () => ({})), keep: vi.fn(async () => ({})), amend: vi.fn(async () => ({})), suspend: vi.fn(async () => ({})) });
  const card = mandateToDecision(mandate({ status: 'draft', envelope: { envelopeVersion: 0 } }), m, tx, 'Later');

  it('signs with the card envelope and drops with the reason the prompt captured', async () => {
    const d = doors();
    const envelope = { decideScopes: [], mergePolicy: 'gate-green' as const, budgetMonthlyUsd: null };
    expect(await writeMandateVerdict({ item: card, verdict: 'accept', envelope }, d)).toBe(true);
    expect(d.sign).toHaveBeenCalledWith('c1', envelope);
    expect(await writeMandateVerdict({ item: card, verdict: 'reject', reason: 'Not a goal I hold' }, d)).toBe(true);
    expect(d.drop).toHaveBeenCalledWith('c1', 'Not a goal I hold');
    await writeMandateVerdict({ item: card, verdict: 'reject' }, d);
    expect(d.drop).toHaveBeenLastCalledWith('c1', null);
    await expect(writeMandateVerdict({ item: card, verdict: 'accept' }, d)).rejects.toThrow(/envelope/);
  });

  it('routes a breach amend and suspend to the mandate, and leaves every other verdict to the roster', async () => {
    const d = doors();
    const idea = item({ id: 'idea:1', kind: 'idea' });
    await writeMandateVerdict({ item: idea, verdict: 'accept', mandateAct: { op: 'amend', charterId: 'c1', change: { kind: 'widenScope', scopes: ['idea.accept'] } } }, d);
    expect(d.amend).toHaveBeenCalledWith('c1', { kind: 'widenScope', scopes: ['idea.accept'] });
    await writeMandateVerdict({ item: idea, verdict: 'done', mandateAct: { op: 'suspend', charterId: 'c1' } }, d);
    expect(d.suspend).toHaveBeenCalledWith('c1');
    expect(isMandateWrite({ item: idea, verdict: 'accept' })).toBe(false);
    expect(await writeMandateVerdict({ item: idea, verdict: 'accept' }, d)).toBe(false);
  });
});
