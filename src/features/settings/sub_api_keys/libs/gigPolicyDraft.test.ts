/**
 * The gig persona policy approves kp hires on the operator's behalf inside its
 * bound. A budget field is the bound's ceiling, so what is pinned here is that
 * an empty field is the only way to say "no cap", and that a field the form
 * cannot read blocks the save instead of being sent as a silent "no cap".
 */
import { describe, it, expect } from 'vitest';
import type { GigPersonaPolicy } from '@/api/auth/gigPersonaPolicy';
import { budgetFromDraft, budgetUnreadable, fromDraft, toDraft, type Draft } from './gigPolicyDraft';

const stored: GigPersonaPolicy = {
  enabled: true,
  maxBudgetUsd: 2.5,
  allowedModels: ['sonnet', 'haiku'],
  rootPath: 'C:/gigs',
};

const draft = (over: Partial<Draft> = {}): Draft => ({ ...toDraft(stored), ...over });

describe('gig policy draft', () => {
  it('round-trips a stored policy', () => {
    expect(fromDraft(toDraft(stored))).toEqual(stored);
    expect(toDraft({ ...stored, maxBudgetUsd: null }).maxBudgetUsd).toBe('');
  });

  it('only an empty (or blank) budget field means no cap', () => {
    expect(budgetFromDraft('')).toBeNull();
    expect(budgetFromDraft('   ')).toBeNull();
    expect(budgetFromDraft('0')).toBe(0);
    expect(budgetFromDraft(' 4.5 ')).toBe(4.5);
  });

  it('a budget the form cannot read blocks the save', () => {
    // The browser reports unparseable number-input text as '' with badInput set.
    expect(budgetUnreadable(draft({ maxBudgetUsd: '', budgetBadInput: true }))).toBe(true);
    expect(budgetUnreadable(draft({ maxBudgetUsd: 'abc' }))).toBe(true);
    expect(budgetUnreadable(draft({ maxBudgetUsd: '5,5' }))).toBe(true);
    expect(budgetUnreadable(draft({ maxBudgetUsd: '' }))).toBe(false);
    expect(budgetUnreadable(draft({ maxBudgetUsd: '3' }))).toBe(false);
  });

  it('normalizes the model list and root path', () => {
    const out = fromDraft(draft({ allowedModels: ' sonnet, ,haiku ,', rootPath: '  C:/gigs  ' }));
    expect(out.allowedModels).toEqual(['sonnet', 'haiku']);
    expect(out.rootPath).toBe('C:/gigs');
  });
});
