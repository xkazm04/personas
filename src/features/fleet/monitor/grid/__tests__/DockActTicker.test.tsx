// The dock's act ticker (mandate-lanes WP7): push only, one coalesced line,
// a press opens the act log at the line's newest act, and nothing at all
// renders before the first act.

import { act as actNow, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CharterAct } from '@/lib/bindings/CharterAct';

import { DockActTicker } from '../DockActTicker';
import { getActiveTranslations } from '@/i18n/useTranslation';

import { TICK_WINDOW_MS, coalesceAct, stewardWord, tickWhat } from '../dockActLine';
import { ACT_VERBS, verbLabel } from '../prototype/entry-e/mandate/actWords';
import { useMandateDrawerRequest } from '../prototype/entry-e/mandate/mandateDrawerRequest';

let push: ((a: CharterAct) => void) | null = null;
vi.mock('@/features/decision-center/lanes/useLanesSnapshot', () => ({
  useCharterActRecorded: (h: (a: CharterAct) => void) => { push = h; },
}));
const getMandate = vi.fn(async (_id: string) => ({ stewardName: 'App Master', projectName: 'personas' }));
vi.mock('@/api/mandates', () => ({ getMandate: (id: string) => getMandate(id) }));

const T0 = Date.parse('2026-10-15T10:00:00Z');
function charterAct(id: string, over: Partial<CharterAct> = {}): CharterAct {
  return {
    id, charterId: 'ch-1', envelopeVersion: 2, itemKind: 'report', itemId: `report:${id}`,
    verdict: 'filed as evidence', actor: 'router', scope: 'report.read', reversible: true, costUsd: null,
    shownJson: null, envChange: null, revertedAt: null, revertActId: null, originDevice: null,
    createdAt: new Date(T0).toISOString(), ...over,
  };
}

beforeEach(() => {
  push = null;
  getMandate.mockClear();
  useMandateDrawerRequest.setState({ pending: null });
});

describe('DockActTicker', () => {
  it('is quiet before the first act: an empty live region, no text, no lamp', () => {
    render(<DockActTicker />);
    const region = screen.getByTestId('dock-act-ticker');
    expect(region.getAttribute('role')).toBe('status');
    expect(region.childElementCount).toBe(0);
    expect(region.textContent).toBe('');
    expect(push).not.toBeNull();
  });

  it('folds three filings into one line and opens the act log at the newest act', async () => {
    render(<DockActTicker />);
    actNow(() => {
      push!(charterAct('a1'));
      push!(charterAct('a2', { createdAt: new Date(T0 + 30_000).toISOString() }));
      push!(charterAct('a2')); // the same event delivered twice counts once
      push!(charterAct('a3', { createdAt: new Date(T0 + 60_000).toISOString() }));
    });
    const open = await screen.findByTestId('dock-act-ticker-open');
    expect(open.textContent).toBe('App Master · personas filed 3 reports as evidence');
    expect(screen.getAllByTestId('dock-act-ticker')).toHaveLength(1);
    expect(getMandate).toHaveBeenCalledTimes(1);

    fireEvent.click(open);
    expect(useMandateDrawerRequest.getState().pending?.actId).toBe('a3');
  });

  it('starts a new line for another verb, and speaks for you in your own acts', async () => {
    render(<DockActTicker />);
    actNow(() => {
      push!(charterAct('a1'));
      push!(charterAct('a9', { actor: 'operator', itemKind: 'mandate', verdict: 'signed', scope: null }));
    });
    await waitFor(() => expect(screen.getByTestId('dock-act-ticker-open').textContent).toBe('You · personas signed the mandate'));
  });
});

describe('coalesceAct', () => {
  it('does not join acts outside the window', () => {
    const first = coalesceAct(null, charterAct('a1'));
    const late = coalesceAct(first, charterAct('a2', { createdAt: new Date(T0 + TICK_WINDOW_MS + 1).toISOString() }));
    expect(late.actIds).toEqual(['a2']);
    const near = coalesceAct(first, charterAct('a2', { createdAt: new Date(T0 + TICK_WINDOW_MS).toISOString() }));
    expect(near.actIds).toEqual(['a1', 'a2']);
  });
});

describe('the ticker words', () => {
  const m = getActiveTranslations().monitor;
  const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

  it('give every verb its own words, in the ticker and in the act log', () => {
    const ticks = ACT_VERBS.map((v) => tickWhat(m, tx, v, 1));
    const labels = ACT_VERBS.map((v) => verbLabel(m, v));
    expect(ticks.every((w) => w && !w.includes('{'))).toBe(true);
    expect(new Set(ticks).size).toBe(ACT_VERBS.length);
    expect(new Set(labels).size).toBe(ACT_VERBS.length);
  });

  it('never says decided for a drop, a keep, a draft or an adoption', () => {
    for (const verdict of ['dropped', 'kept', 'drafted', 'adopted']) {
      const line = coalesceAct(null, charterAct('a1', { itemKind: 'mandate', verdict, actor: 'operator' }));
      expect(line.verb).toBe(verdict);
      expect(tickWhat(m, tx, line.verb, 1)).not.toBe(tickWhat(m, tx, 'decided', 1));
    }
    expect(tickWhat(m, tx, 'kept', 1)).toBe(m.ml_tick_kept);
  });
});

describe('stewardWord', () => {
  it('drops a separated trailing project, keeps everything else whole', () => {
    expect(stewardWord('App Master · personas', 'personas')).toBe('App Master');
    expect(stewardWord('App Master', 'personas')).toBe('App Master');
    expect(stewardWord('Personas', 'personas')).toBe('Personas');
    expect(stewardWord('Athena', null)).toBe('Athena');
  });
});
