// The act log speaks in words (mandate-lanes WP7 polish of WP4): the verb and
// the item's title from `shown_json`, the kind in plain words when there is no
// title, the reverted act's verb for a revert; never the raw verdict token or
// item id as the headline. And the drawer opens the act log at an act a
// request names (the dock ticker's door).

import { act as actNow, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { getActiveTranslations } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';

import { actHeadline, shownWords, verbOf } from '../actWords';
import { useMandateDrawer } from '../MandateDrawer';
import { requestActLogAt } from '../mandateDrawerRequest';

const m = getActiveTranslations().monitor;
const base: CharterAct = {
  id: 'a1', charterId: 'ch-1', envelopeVersion: 2, itemKind: 'report', itemId: 'report:a1',
  verdict: 'filed as evidence', actor: 'router', scope: 'report.read', reversible: true, costUsd: null,
  shownJson: null, envChange: null, revertedAt: null, revertActId: null, originDevice: null,
  createdAt: '2026-10-15T10:00:00Z',
};

describe('actHeadline', () => {
  it('says the verb and the title the router was shown', () => {
    const a = { ...base, shownJson: JSON.stringify({ itemKind: 'report', title: 'Nightly gate report' }) };
    expect(actHeadline(m, a)).toEqual({ verb: 'Filed as evidence', what: 'Nightly gate report' });
  });

  it('falls back to the kind in plain words, never the id', () => {
    const h = actHeadline(m, { ...base, itemKind: 'review', verdict: 'approved' });
    expect(h).toEqual({ verb: 'Approved', what: 'a review' });
    expect(`${h.verb} ${h.what}`).not.toContain('report:a1');
  });

  it('names an envelope act by the mandate and a revert by what it undid', () => {
    expect(actHeadline(m, { ...base, itemKind: 'mandate', verdict: 'merge-policy-set' }, 'Keep it shippable'))
      .toEqual({ verb: 'Merge policy changed', what: 'Keep it shippable' });
    const revert = { ...base, itemKind: 'act.revert', verdict: 'reverted', shownJson: JSON.stringify({ revertedAct: 'a0', verdict: 'filed as evidence' }) };
    expect(actHeadline(m, revert)).toEqual({ verb: 'Reverted', what: 'Filed as evidence' });
  });

  it('reads an unknown token as decided and a broken shown_json as no title', () => {
    expect(verbOf('frobbed')).toBe('decided');
    expect(shownWords('{not json')).toEqual({ title: null, verdict: null });
  });
});

describe('useMandateDrawer', () => {
  it('opens the act log at the act a request names', () => {
    const { result } = renderHook(() => useMandateDrawer());
    expect(result.current.view).toBeNull();
    actNow(() => requestActLogAt('a7'));
    expect(result.current.view).toEqual({ kind: 'log', focusActId: 'a7' });
  });
});
