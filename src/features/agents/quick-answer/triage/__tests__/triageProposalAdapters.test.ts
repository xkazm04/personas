/**
 * The two proposal queues the moonshot campaign added, seen through the deck.
 *
 * Both are "a human must decide" rows that already had a bespoke panel or no
 * panel at all, and the properties worth pinning are the ones a shared surface
 * can quietly lose:
 *
 *  • **The trade, not just the win.** A tuning proposal that is cheaper AND
 *    worse must say so where a reviewer cannot skim past it. In the settings
 *    section the quality delta is a caption under the claim; here it is the
 *    card's one alert, and only when it is bad news.
 *  • **Four measured values, two scales.** A promotion's incumbent/challenger
 *    scores live in `0..1`; its gain and threshold are deltas ON that scale and
 *    are ~an order of magnitude smaller. Sharing one scale would have flattened
 *    the only two numbers the decision turns on into invisible slivers.
 *  • **The expectation rides.** Both rows carry `seenStatus` into `payload`, the
 *    same compare-and-swap contract wave A gave reviews, ideas and practices.
 */
import { describe, it, expect } from 'vitest';

import type { EvolutionPromotionProposal } from '@/lib/bindings/EvolutionPromotionProposal';
import type { PolicyProposal } from '@/lib/bindings/PolicyProposal';

import {
  DEFAULT_TRIAGE_COPY,
  evolutionProposalToTriage,
  policyProposalToTriage,
} from '../triageAdapters';
import { reasonPromptFor, type TriageFact } from '../triageTypes';

const copy = DEFAULT_TRIAGE_COPY;

const evidence: PolicyProposal['evidence'] = {
  id: 'polsnap_1',
  windowDays: 14,
  generatedAt: '2026-02-01T00:00:00.000Z',
  cells: [],
  healing: { attempted: 0, succeeded: 0, success_rate: 0 } as PolicyProposal['evidence']['healing'],
  monthlySpendUsd: 42,
  monthlySpendRows: 12,
  monthlyCeilingUsd: 0,
};

function routingProposal(qualityDeltaPct = 0.01): PolicyProposal {
  return {
    id: 'pol-1',
    kind: 'routing_rule',
    routing: {
      category: 'summarise',
      fromModel: 'big-model',
      toModel: 'small-model',
      claim: {
        projectedMonthlySavingUsd: 12.5,
        savingPct: 0.62,
        qualityBasis: 'lab',
        qualityDeltaPct,
        incumbentRuns: 40,
        challengerRuns: 18,
        incumbentSuccessRate: 0.95,
        challengerSuccessRate: 0.93,
        incumbentAvgCostUsd: 0.02,
        challengerAvgCostUsd: 0.008,
      },
    },
    evidenceSnapshotId: 'polsnap_1',
    evidence,
    status: 'pending',
    createdAt: '2026-02-02T00:00:00.000Z',
  };
}

function budgetProposal(overrides: Partial<PolicyProposal['budget']> = {}): PolicyProposal {
  return {
    id: 'pol-2',
    kind: 'budget_ceiling',
    budget: {
      currentCeilingUsd: 0,
      proposedCeilingUsd: 60,
      observedMonthlySpendUsd: 42,
      spendRows: 12,
      direction: 'introduce',
      ...overrides,
    },
    evidenceSnapshotId: 'polsnap_1',
    evidence,
    status: 'pending',
    createdAt: '2026-02-02T00:00:00.000Z',
  };
}

function promotion(overrides: Partial<EvolutionPromotionProposal> = {}): EvolutionPromotionProposal {
  return {
    id: 'prop-1',
    cycleId: 'cyc-1',
    personaId: 'persona-1',
    status: 'pending',
    winnerGenomeJson: '{}',
    newPrompt: 'You are a careful summariser.',
    incumbentScore: 0.72,
    winnerScore: 0.81,
    improvement: 0.09,
    threshold: 0.05,
    fitnessSource: 'measured',
    evidenceJson: '{"replays":12}',
    baseUpdatedAt: '2026-01-20T00:00:00.000Z',
    decisionNote: null,
    createdAt: '2026-02-02T00:00:00.000Z',
    decidedAt: null,
    ...overrides,
  };
}

const factById = (facts: TriageFact[], id: string): TriageFact => {
  const found = facts.find((f) => f.id === id);
  if (!found) throw new Error(`no "${id}" fact on the card`);
  return found;
};

describe('policyProposalToTriage — a routing diff as a card', () => {
  it('states the claim in the title and the body, and never invents a branch', () => {
    const item = policyProposalToTriage(routingProposal(), copy);

    expect(item.id).toBe('policy:pol-1');
    expect(item.kind).toBe('policy');
    expect(item.title).toBe('Route summarise work to small-model');
    expect(item.body).toContain('$12.50');
    expect(item.body).toContain('62%');
    // `policy_tuning_apply` is the ONLY policy writer — a third act on this card
    // would need a second one.
    expect(item.branches).toEqual([]);
    expect(item.verdictLabels).toEqual({ accept: 'Apply', reject: 'Decline', skip: 'Skip' });
  });

  it('meters the RELATIVE saving, because dollars alone say nothing', () => {
    const saving = factById(policyProposalToTriage(routingProposal(), copy).facts, 'saving');
    expect(saving.value).toBe('$12.50/mo');
    expect(saving.score).toEqual({ value: 0.62, max: 1 });
  });

  it('promotes a NEGATIVE quality delta to the card alert, and leaves a positive one a fact', () => {
    const worse = policyProposalToTriage(routingProposal(-0.02), copy);
    expect(worse.alert?.id).toBe('quality');
    expect(worse.alert?.detail).toContain('-2.0%');
    expect(worse.alert?.detail).toContain('Lab scores');
    expect(factById(worse.facts, 'quality').tone).toBe('danger');

    const better = policyProposalToTriage(routingProposal(0.03), copy);
    expect(better.alert).toBeUndefined();
    expect(factById(better.facts, 'quality').tone).toBe('success');
  });

  it('offers decline reasons whose WRITTEN values stay canonical English', () => {
    // The reason lands in `policy_proposals.decline_reason` and is read back
    // verbatim by the settings history — a locale-shaped sentence there is a
    // record nobody else can use.
    const localised = { ...copy, reasonQualityRisk: 'Riesgo de calidad' };
    const prompt = reasonPromptFor(policyProposalToTriage(routingProposal(), localised), 'reject')!;
    const option = prompt.options.find((o) => o.id === 'quality_risk')!;
    expect(option.label).toBe('Riesgo de calidad');
    expect(option.value).toBe('Quality risk');
    expect(prompt.freeText).toBe(true);
  });

  it('carries the row status as the compare-and-swap expectation', () => {
    expect(policyProposalToTriage(routingProposal(), copy).payload?.seenStatus).toBe('pending');
  });
});

describe('policyProposalToTriage — a budget ceiling as a card', () => {
  it('names the direction in the title and says what there is to go on', () => {
    expect(policyProposalToTriage(budgetProposal(), copy).title).toBe(
      'Introduce a monthly ceiling of $60.00',
    );
    expect(
      policyProposalToTriage(budgetProposal({ direction: 'lower', currentCeilingUsd: 100 }), copy)
        .title,
    ).toBe('Lower the monthly ceiling to $60.00');
    // "None" rather than "$0.00": there is no ceiling, which is not a ceiling of
    // nothing.
    expect(factById(policyProposalToTriage(budgetProposal(), copy).facts, 'ceiling').value).toBe(
      'None',
    );
  });

  it('INVERTS the spend meter — a nearly-full bar is the bad news', () => {
    const spend = factById(policyProposalToTriage(budgetProposal(), copy).facts, 'spend');
    expect(spend.score).toEqual({ value: 42, max: 60, invert: true });
  });

  it('outranks a routing proposal, because the money is already leaving', () => {
    expect(policyProposalToTriage(budgetProposal(), copy).weight).toBeGreaterThan(
      policyProposalToTriage(routingProposal(), copy).weight,
    );
  });
});

describe('evolutionProposalToTriage — four measured values, two scales', () => {
  it('puts the two SCORES on the natural 0..1 scale', () => {
    const facts = evolutionProposalToTriage(promotion(), 'Scribe', '#abc', copy).facts;
    expect(factById(facts, 'incumbent').score).toEqual({ value: 0.72, max: 1 });
    expect(factById(facts, 'winner').score).toEqual({ value: 0.81, max: 1 });
    expect(factById(facts, 'incumbent').value).toBe('72%');
  });

  it('puts the two DELTAS on their own shared scale, sized to the larger', () => {
    const facts = evolutionProposalToTriage(promotion(), 'Scribe', null, copy).facts;
    const gain = factById(facts, 'gain');
    const bar = factById(facts, 'bar');
    // max(0.09, 0.05) * 1.25 — headroom so a winner that beat the bar outright
    // still has bar left to show for it.
    expect(gain.score?.max).toBeCloseTo(0.1125, 6);
    expect(bar.score?.max).toBe(gain.score?.max);
    expect(gain.score?.value).toBe(0.09);
    expect(bar.score?.value).toBe(0.05);
    expect(gain.value).toBe('+9.0 pts');
    // NOT inverted: a low bar is weak evidence, not good news.
    expect(bar.score?.invert).toBeUndefined();
  });

  it('makes the persona optimistic lock the card ALERT, not a fact nobody reads', () => {
    const item = evolutionProposalToTriage(promotion(), 'Scribe', null, copy);
    expect(item.alert?.id).toBe('lock');
    expect(item.alert?.tone).toBe('warning');
    // The token itself stays a machine value in payload, and a legible one in
    // the ledger.
    expect(item.payload?.baseUpdatedAt).toBe('2026-01-20T00:00:00.000Z');
    expect(factById(item.facts, 'lockedAt').value).toBe('2026-01-20T00:00:00.000Z');
  });

  it('judges the case on the WINNER PROMPT, which is exactly what approving installs', () => {
    const item = evolutionProposalToTriage(promotion(), 'Scribe', null, copy);
    expect(item.title).toBe('Promote the evolved Scribe');
    expect(item.body).toBe('You are a careful summariser.');
    expect(item.evidence).toContain('replays');
    expect(item.branches).toEqual([]);
    expect(item.verdictLabels.accept).toBe('Promote');
  });

  it('falls back to the persona id rather than rendering an empty owner', () => {
    expect(evolutionProposalToTriage(promotion(), '', null, copy).title).toContain('persona-1');
  });

  it('weights by the MARGIN over the bar, capped below an incident', () => {
    const scraped = evolutionProposalToTriage(
      promotion({ improvement: 0.051, threshold: 0.05 }),
      'Scribe',
      null,
      copy,
    );
    const smashed = evolutionProposalToTriage(
      promotion({ improvement: 0.4, threshold: 0.05 }),
      'Scribe',
      null,
      copy,
    );
    expect(smashed.weight).toBeGreaterThan(scraped.weight);
    // Never an incident: `critical` reviews sit at 120.
    expect(smashed.weight).toBeLessThan(120);
    // Above every practice (max ~75) and just under a halted build (90).
    expect(scraped.weight).toBeGreaterThan(75);
    expect(scraped.weight).toBeLessThan(90);
  });

  it('records a rejection note with canonical English values', () => {
    const prompt = reasonPromptFor(
      evolutionProposalToTriage(promotion(), 'Scribe', null, copy),
      'reject',
    )!;
    expect(prompt.options.map((o) => o.value)).toEqual([
      'Gain too small',
      'Prompt reads worse',
      'Run a fresh cycle',
    ]);
  });
});
