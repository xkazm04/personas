// @vitest-environment node
/**
 * The Breach card's head lines and mandate state (mandate-lanes WP5P):
 *  - `breachOutcomes` gives one line per numbered verdict the dock prints, in
 *    its order (amend, deny, then suspend only when there is a mandate to
 *    suspend), and each amend kind says what IT does: widen, let merges land,
 *    raise the cap, or the item's own yes;
 *  - `mandateStateOf` / `mandateStateLine` say what is true when the mandate
 *    cannot be amended: unsigned (named), none (the Orphans lane), no
 *    project, or not loaded; a signed mandate adds no line.
 */
import { describe, expect, it } from 'vitest';

import { en } from '@/i18n/en';

import type { MonitorCopy } from '../../deck/deckMeta';
import { noEffect } from '../../deck/outcome';
import { item } from '../../__tests__/rosterFixtures';
import { breachOutcomes, breachPlan, mandateStateLine, mandateStateOf } from '../breachPlan';
import { mandate } from './mandateFixtures';

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor as MonitorCopy;
const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));
const usd = (n: number) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
const ctx = { project: 'Personas', cap: null, usd };

const idea = item({ id: 'idea:1', kind: 'idea', title: 'Cache the board', verdictLabels: { accept: 'Accept', reject: 'Reject', skip: 'Later' } });
const incident = item({ id: 'incident:7', kind: 'incident', severity: 'high', title: 'Builds failing', verdictLabels: { accept: 'Resolve', reject: 'Dismiss', skip: 'Later' } });
const verbs = (lines: { verb: string }[]) => lines.map((l) => l.verb);

describe('breachOutcomes: one line per dock verb, in dock order', () => {
  it('scope on a signed mandate: widen, deny, suspend', () => {
    const plan = breachPlan(idea, 'scope', mandate());
    const lines = breachOutcomes(m, tx, idea, plan, ctx);
    expect(verbs(lines)).toEqual([m.ml_breach_out_widen_verb, m.ml_breach_out_deny_verb, m.ml_breach_out_suspend_verb]);
    expect(lines[0]!.effect).toContain(m.ml_scope_idea_accept);
    expect(lines[1]!.effect).toContain(noEffect(m, 'idea'));
    expect(lines[2]!.effect).toContain('Personas');
  });

  it('merge on a never-merge mandate: let merges land, named with the policy it sets', () => {
    const review = item({ id: 'review:9', kind: 'review', title: 'Merge the parser' });
    const plan = breachPlan(review, 'merge', mandate());
    const lines = breachOutcomes(m, tx, review, plan, ctx);
    expect(verbs(lines)).toEqual([m.ml_breach_out_merge_verb, m.ml_breach_out_deny_verb, m.ml_breach_out_suspend_verb]);
    expect(lines[0]!.effect).toContain(m.ml_merge_gate_green);
  });

  it('spend: the cap line follows the typed cap, today\'s cap until one is typed', () => {
    const plan = breachPlan(idea, 'spend', mandate({ envelope: { budgetMonthlyUsd: 40 } }));
    expect(breachOutcomes(m, tx, idea, plan, ctx)[0]!.effect).toContain('$40');
    expect(breachOutcomes(m, tx, idea, plan, { ...ctx, cap: 75 })[0]).toMatchObject({ verb: m.ml_breach_out_spend_verb });
    expect(breachOutcomes(m, tx, idea, plan, { ...ctx, cap: 75 })[0]!.effect).toContain('$75');
  });

  it('a stop decides the item itself: its own verb first, the dock\'s label', () => {
    const plan = breachPlan(incident, 'stop', mandate());
    const lines = breachOutcomes(m, tx, incident, plan, ctx);
    expect(verbs(lines)).toEqual(['resolve', m.ml_breach_out_deny_verb, m.ml_breach_out_suspend_verb]);
    expect(lines[1]!.effect).toContain(noEffect(m, 'incident'));
  });

  it('no mandate: amend and deny only, because the dock prints no suspend', () => {
    const plan = breachPlan(idea, 'scope', null);
    expect(verbs(breachOutcomes(m, tx, idea, plan, ctx))).toEqual(['accept', m.ml_breach_out_deny_verb]);
  });

  it('a suspended mandate cannot be suspended again: two lines', () => {
    const plan = breachPlan(idea, 'risk', mandate({ status: 'suspended' }));
    expect(breachOutcomes(m, tx, idea, plan, ctx)).toHaveLength(2);
  });
});

describe('mandateStateOf / mandateStateLine', () => {
  it('a signed mandate says nothing more', () => {
    const s = mandateStateOf('c1', mandate(), 'p1', null, 'Unknown');
    expect(s).toEqual({ kind: 'signed' });
    expect(mandateStateLine(m, tx, s)).toBeNull();
  });

  it('an unsigned mandate names its project and what signing changes', () => {
    const s = mandateStateOf('c1', mandate({ envelope: { envelopeVersion: 0 } }), 'p1', null, 'Unknown');
    expect(s).toEqual({ kind: 'unsigned', project: 'Personas' });
    expect(mandateStateLine(m, tx, s)).toBe(tx(m.ml_breach_state_unsigned, { project: 'Personas' }));
  });

  it('no charter on a known project points at the Orphans lane', () => {
    const s = mandateStateOf(null, null, 'p9', 'Ascent', 'Unknown');
    expect(s).toEqual({ kind: 'none', project: 'Ascent' });
    expect(mandateStateLine(m, tx, s)).toContain('Ascent');
  });

  it('no charter and an unresolved name falls back to the catalog word, never blank', () => {
    expect(mandateStateOf(null, null, 'p9', null, 'Unknown project')).toEqual({ kind: 'none', project: 'Unknown project' });
  });

  it('no project at all, and a charter whose summary did not load, are their own states', () => {
    expect(mandateStateOf(null, null, null, null, 'Unknown')).toEqual({ kind: 'no-project' });
    expect(mandateStateOf('c1', null, 'p1', null, 'Unknown')).toEqual({ kind: 'unread' });
    expect(mandateStateLine(m, tx, { kind: 'unread' })).toBe(m.ml_breach_state_unread);
  });
});
