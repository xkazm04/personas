/**
 * The findings ledger page (spark bp-fidelity Stage B), mounted on the fixture source:
 *  - L opens and closes it; Esc leaves it through the sheet's own ladder; 1 / 2 / 3 switch its tabs while it is up;
 *  - J / K walk the In packs rows; Y / R / S / U triage the current row through `actions.triage` with its id (R asks the
 *    note first); Space checks rows into the shared selection and the foot bar's batch goes as ONE call with every id;
 *  - the backlog's A approves through `actions.decide`;
 *  - the Release tab never writes: Create draft, Undo and LENSES open bp (the link is built from the product's root).
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { BlueprintSheet } from '../BlueprintSheet';
import { createFixtureActions } from '../fixture/actions';
import { kettleData } from '../fixture/kettle';
import { resetLedgerStore } from '../ledger/ledgerStore';
import type { BlueprintData } from '../source';

const openExternalUrl = vi.fn(async (_url: string) => {});
vi.mock('@/api/system/system', async (orig) => ({ ...(await orig<typeof import('@/api/system/system')>()), openExternalUrl: (url: string) => openExternalUrl(url) }));
vi.mock('@/api/system/settings', async (orig) => ({ ...(await orig<typeof import('@/api/system/settings')>()), getAppSetting: async () => null }));
vi.mock('@/hooks/utility/interaction/useMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/hooks/utility/interaction/useMotion')>()),
  useReducedMotion: () => true,
}));

beforeAll(() => {
  const ctx = new Proxy({ measureText: () => ({ width: 8 }), createPattern: () => ({ setTransform() {} }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => undefined),
    set: (t, k: string, v) => { t[k] = v; return true; },
  });
  HTMLCanvasElement.prototype.getContext = (() => ctx) as unknown as HTMLCanvasElement['getContext'];
  class FakePath { rect() {} moveTo() {} lineTo() {} closePath() {} addPath() {} }
  vi.stubGlobal('Path2D', FakePath);
  vi.stubGlobal('DOMMatrix', class { constructor(public v?: number[]) {} });
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} } as DOMRect);
});

const key = (k: string) => act(() => { fireEvent.keyDown(window, { key: k }); });
let actions: ReturnType<typeof createFixtureActions>;

function mount(data: BlueprintData = kettleData()) {
  return render(<AppKeyboardProvider><BlueprintSheet data={data} actions={actions} onClose={() => {}} /></AppKeyboardProvider>);
}
async function openLedger(data?: BlueprintData) {
  mount(data);
  await waitFor(() => expect(screen.getByTestId('blueprint-sheet')).toBeTruthy());
  key('l');
  await waitFor(() => expect(screen.getByTestId('blueprint-ledger')).toBeTruthy());
}
const focused = () => document.querySelector('.tr-row.tr-fx')?.getAttribute('data-fid');
const walkTo = (n: number) => { for (let i = 0; i < n; i++) key('j'); };

beforeEach(() => { resetLedgerStore(); actions = createFixtureActions(kettleData()); openExternalUrl.mockClear(); });
afterEach(() => { vi.clearAllMocks(); });

describe('the ledger page', () => {
  it('L opens it over the plan with the page switch pressed, L again closes it, and Esc leaves it', async () => {
    await openLedger();
    expect(screen.getByTestId('blueprint-page-ledger').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('blueprint-ledger').getAttribute('data-tab')).toBe('triage');
    key('l');
    await waitFor(() => expect(screen.queryByTestId('blueprint-ledger')).toBeNull());
    key('l');
    await screen.findByTestId('blueprint-ledger');
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-ledger')).toBeNull());
  });

  it('the page switch in the title line counts the open findings and opens the ledger', async () => {
    mount();
    const sw = await screen.findByTestId('blueprint-page-ledger');
    expect(sw.textContent).toMatch(/8$/);
    fireEvent.click(sw);
    await screen.findByTestId('blueprint-ledger');
  });

  it('1, 2 and 3 switch the tabs while the ledger is up', async () => {
    await openLedger();
    const page = screen.getByTestId('blueprint-ledger');
    key('2');
    await waitFor(() => expect(page.getAttribute('data-tab')).toBe('matrix'));
    expect(screen.getByTestId('blueprint-ledger-matrix')).toBeTruthy();
    key('3');
    await waitFor(() => expect(page.getAttribute('data-tab')).toBe('release'));
    key('1');
    await waitFor(() => expect(page.getAttribute('data-tab')).toBe('triage'));
  });

  it('J and K walk the In packs rows, packs oldest first', async () => {
    await openLedger();
    walkTo(1);
    expect(focused()).toBe('p-7e21a0');
    walkTo(2);
    expect(focused()).toBe('p-1aab7a');
    key('k');
    expect(focused()).toBe('p-9c40b1');
  });

  it('Y accepts the current row through the store with its id', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await openLedger();
    walkTo(3);
    key('y');
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a'], 'accept', undefined));
  });

  it('R asks the note first, then sends the rework with it; U reopens the current row', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await openLedger();
    walkTo(3);
    key('r');
    const input = await screen.findByTestId('blueprint-reason-input');
    fireEvent.change(input, { target: { value: 'Shoot the designed state' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a'], 'rework', 'Shoot the designed state'));
    key('u');
    await waitFor(() => expect(triage).toHaveBeenLastCalledWith(['p-1aab7a'], 'reopen', undefined));
  });

  it('Space checks rows; Y over checked rows is ONE batch with every id', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await openLedger();
    walkTo(3);
    key(' ');
    key('j');
    key(' ');
    await waitFor(() => expect(screen.getByTestId('blueprint-ledger-bar').querySelector('.lg-bar-n')?.textContent).toMatch(/2/));
    key('y');
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a', 'p-54887a'], 'accept', undefined));
    expect(triage).toHaveBeenCalledTimes(1);
  });

  it('the foot bar batches the checked rows through the note prompt (descope asks a note)', async () => {
    const triage = vi.spyOn(actions, 'triage');
    await openLedger();
    walkTo(3);
    key(' ');
    key('j');
    key(' ');
    fireEvent.click(within(screen.getByTestId('blueprint-ledger-bar')).getByTestId('blueprint-triage-descope'));
    const input = await screen.findByTestId('blueprint-reason-input');
    fireEvent.change(input, { target: { value: 'Not worth the risk now' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(triage).toHaveBeenCalledWith(['p-1aab7a', 'p-54887a'], 'descope', 'Not worth the risk now'));
  });

  it('Enter opens the current row in the compare panel; Esc closes the panel before it leaves the page', async () => {
    await openLedger();
    walkTo(3);
    key('Enter');
    await waitFor(() => expect(screen.getByTestId('blueprint-compare').getAttribute('data-item')).toBe('p-1aab7a'));
    key('Escape');
    await waitFor(() => expect(screen.queryByTestId('blueprint-compare')).toBeNull());
    expect(screen.getByTestId('blueprint-ledger')).toBeTruthy();
  });

  it('in the backlog, A approves the current finding through the store', async () => {
    const decide = vi.spyOn(actions, 'decide');
    await openLedger();
    fireEvent.click(screen.getByRole('button', { name: /Backlog/ }));
    await waitFor(() => expect(screen.getByTestId('blueprint-ledger').getAttribute('data-scope')).toBe('backlog'));
    key('j');
    const first = document.querySelector('.lg-tr:not(.hd)')?.getAttribute('data-fid');
    key('a');
    await waitFor(() => expect(decide).toHaveBeenCalledWith([first], 'approve', undefined));
  });
});

describe('the Release tab never writes', () => {
  const writes = () => [vi.spyOn(actions, 'decide'), vi.spyOn(actions, 'triage'), vi.spyOn(actions, 'start')];

  it('Create draft opens bp at the product instead of cutting a release', async () => {
    const data = kettleData();
    data.scan.releases = [];
    data.scan.proposals = data.scan.proposals.map((p) => (p.release_id ? { ...p, release_id: undefined } as typeof p : p));
    actions = createFixtureActions(data);
    const spies = writes();
    await openLedger(data);
    key('3');
    const cut = await screen.findByTestId('blueprint-ledger-rel-cut');
    await waitFor(() => expect((cut as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(cut);
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(1));
    const url = new URL(openExternalUrl.mock.calls[0]![0]);
    expect(url.searchParams.get('product')).toBe('kettle');
    expect(url.searchParams.get('tab')).toBe('release');
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });

  it('a package row Undo and the LENSES button open bp; nothing reaches the store', async () => {
    const spies = writes();
    await openLedger();
    key('3');
    const pkg = await screen.findByTestId('blueprint-ledger-package');
    const undo = within(pkg).getAllByRole('button').find((b) => /Undo/.test(b.textContent ?? ''))!;
    await waitFor(() => expect((undo as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(undo);
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('blueprint-ledger-lenses'));
    await waitFor(() => expect(openExternalUrl).toHaveBeenCalledTimes(2));
    const lenses = new URL(openExternalUrl.mock.calls[1]![0]);
    expect(lenses.searchParams.get('page')).toBe('ledger');
    expect(lenses.searchParams.has('tab')).toBe(false);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
