/**
 * The Scopes section (mandate-lanes WP6): lines from the backend payload, W
 * widens and N narrows the picked line through `mandate_amend`, and a widen
 * touching merge or spend (or dispatch, as the payload says) ARMS first and
 * lists what will no longer reach the operator; only the second press writes.
 * An unsigned mandate writes nothing and says why.
 */
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { en } from '@/i18n/en';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import type { MandateScopes } from '@/lib/bindings/MandateScopes';
import { ScopesView } from '../scopes/ScopesView';
import { scopeLines } from '../scopes/scopesModel';
import { useScopes } from '../scopes/useScopes';

const api = vi.hoisted(() => ({ getMandateScopes: vi.fn(), amendMandate: vi.fn(async () => ({})) }));
vi.mock('@/api/mandates', () => api);
vi.mock('@/features/decision-center/lanes/useLanesSnapshot', () => ({ useCharterActRecorded: () => {} }));

// eslint-disable-next-line custom/no-module-scope-en-value -- tests assert the English catalog's own words
const m = en.monitor;
const tx = (tpl: string, vars: Record<string, string | number>) => tpl.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k]));

const ITEM = (n: number) => ({ itemId: `idea:${n}`, itemKind: 'idea', title: `Idea ${n}` });
function payload(over: Partial<MandateScopes> = {}): MandateScopes {
  return {
    charterId: 'c1', signed: true, asks: 3,
    rows: [
      { scope: 'idea.accept', held: false, acts: 0, absorbs: 3, absorbed: [ITEM(1), ITEM(2), ITEM(3)], arms: false },
      { scope: 'report.read', held: true, acts: 12, absorbs: 0, absorbed: [], arms: false },
      { scope: 'dispatch', held: false, acts: 0, absorbs: 0, absorbed: [], arms: true },
    ],
    merge: { policy: 'never', widenTo: 'gate-green+council-ready', narrowTo: null, absorbs: 1, absorbed: [ITEM(9)] },
    spend: { capUsd: 40, usedUsd: 12, widenToUsd: 50, narrowToUsd: 35, absorbs: 0, absorbed: [] },
    failedSources: [],
    ...over,
  };
}

function Harness() {
  const state = useScopes('c1', () => {});
  const [selected, setSelected] = useState(0);
  return <ScopesView state={state} selected={selected} onSelect={setSelected} />;
}

const key = (k: string) => fireEvent.keyDown(window, { key: k });
const mount = () => render(<AppKeyboardProvider><Harness /></AppKeyboardProvider>);

afterEach(() => { api.amendMandate.mockClear(); });

describe('scope lines', () => {
  it('say acts and a design agreement for held scopes, real absorption for the rest', () => {
    const lines = scopeLines(payload(), m, tx, 'en');
    expect(lines.map((l) => l.id)).toEqual(['idea.accept', 'report.read', 'dispatch', 'merge', 'spend']);
    expect(lines[0]!.detail).toBe('Would take 3 items waiting on you now');
    expect(lines[0]!.widen).toEqual({ kind: 'widenScope', scopes: ['idea.accept'] });
    expect(lines[1]!.detail).toBe('12 acts under it');
    expect(lines[1]!.narrow).toEqual({ kind: 'narrowScope', scopes: ['report.read'] });
    expect(lines[3]!.arms && lines[4]!.arms && lines[2]!.arms).toBe(true);
    expect(lines[0]!.arms).toBe(false);
    expect(lines[4]!.widen).toEqual({ kind: 'setBudget', usd: 50 });
    expect(lines[4]!.widenWhat).toContain('$40');
    expect(scopeLines(payload({ signed: false }), m, tx, 'en')[0]!.detail).toContain('Signed with it, 3 items');
  });
});

describe('ScopesView', () => {
  it('widens a plain scope on one W and narrows a held one on N', async () => {
    api.getMandateScopes.mockResolvedValue(payload());
    mount();
    await screen.findAllByTestId('mandate-scope-row');
    expect(screen.getByTestId('mandate-scopes').textContent).toContain(m.ml_scopes_agreement_design);
    key('w');
    await waitFor(() => expect(api.amendMandate).toHaveBeenCalledWith('c1', { kind: 'widenScope', scopes: ['idea.accept'] }));
    key('ArrowDown');
    key('n');
    await waitFor(() => expect(api.amendMandate).toHaveBeenLastCalledWith('c1', { kind: 'narrowScope', scopes: ['report.read'] }));
  });

  it('arms a merge widen twice and lists what will no longer reach you; Esc disarms', async () => {
    api.getMandateScopes.mockResolvedValue(payload());
    mount();
    await screen.findAllByTestId('mandate-scope-row');
    key('ArrowDown'); key('ArrowDown'); key('ArrowDown');
    key('w');
    expect(api.amendMandate).not.toHaveBeenCalled();
    const armed = screen.getByTestId('scopes-armed');
    expect(armed.textContent).toContain('1 items waiting on you now will no longer reach you');
    expect(armed.textContent).toContain('Idea 9');
    key('Escape');
    expect(screen.queryByTestId('scopes-armed')).toBeNull();
    key('w');
    key('w');
    await waitFor(() => expect(api.amendMandate).toHaveBeenCalledWith('c1', { kind: 'setMergePolicy', policy: 'gate-green+council-ready' }));
    expect(api.amendMandate).toHaveBeenCalledTimes(1);
  });

  it('arms a spend widen, and Enter confirms it', async () => {
    api.getMandateScopes.mockResolvedValue(payload());
    mount();
    await screen.findAllByTestId('mandate-scope-row');
    for (let i = 0; i < 4; i++) key('ArrowDown');
    key('w');
    expect(screen.getByTestId('scopes-armed').textContent).toContain('$50');
    key('Enter');
    await waitFor(() => expect(api.amendMandate).toHaveBeenCalledWith('c1', { kind: 'setBudget', usd: 50 }));
  });

  it('writes nothing on an unsigned mandate and says to sign first', async () => {
    api.getMandateScopes.mockResolvedValue(payload({ signed: false }));
    mount();
    await screen.findAllByTestId('mandate-scope-row');
    key('w');
    expect(await screen.findByText(m.ml_scopes_sign_first)).toBeTruthy();
    expect(api.amendMandate).not.toHaveBeenCalled();
  });
});
