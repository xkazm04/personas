/**
 * What floats on the drawing (spark bp-fidelity, WP-D2), over the Kettle fixture's work, each in a sheet of its own:
 *  - the selection bar sends ONE batch call with exactly the picked ids (approve through `decideMany`, every other move
 *    through `askMany`, which asks the note first when the move wants one), offers only the moves some picked status
 *    allows, and clears on its own control;
 *  - the decision card offers the current item's own moves and calls the single-item writes with that item;
 *  - Shift+click on a fixture picks its decidable items (and a second Shift+click drops them).
 */
import { describe, expect, it, vi, type Mock } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SheetContext, type Sheet } from '../controller/SheetContext';
import { useBlueprintText, useEngineWords } from '../controller/useBlueprintText';
import { pickable, useEngineHooks } from '../controller/useEngineHooks';
import type { Engine } from '../engine/Engine';
import { kettleData } from '../fixture/kettle';
import { buildPlan } from '../model/plan';
import { buildWork, type WorkItem } from '../model/work';
import { initialUi, type UiState } from '../state/uiState';
import { TipStore } from '../state/tipStore';
import { ViewStore } from '../state/viewStore';
import { DecisionCard } from '../ui/overlays/DecisionCard';
import { SelBar, batchMoves } from '../ui/overlays/SelBar';
import { placeBeside } from '../ui/overlays/useCardPlace';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);
const work = buildWork(plan.L, data.scan);
const byStatus = (s: WorkItem['status']) => work.items.filter((p) => p.status === s);

interface Spies { writes: Record<string, Mock>; nav: Record<string, Mock>; dispatch: Mock }
function spies(): Spies {
  const w = ['approve', 'askDecline', 'decline', 'arm', 'confirm', 'disarm', 'askTriage', 'triage', 'askMany', 'decideMany', 'triageMany'];
  return { writes: Object.fromEntries(w.map((k) => [k, vi.fn(async () => {})])), nav: Object.fromEntries(['select', 'step', 'openSheet'].map((k) => [k, vi.fn()])), dispatch: vi.fn() };
}

function Host({ ui, sp, children }: { ui: Partial<UiState>; sp: Spies; children: ReactNode }) {
  const text = useBlueprintText(), words = useEngineWords(text), u = { ...initialUi(), ...ui };
  const current = u.itemId ? work.byId.get(u.itemId) ?? null : null;
  const queue = work.items.filter((p) => p.status === 'proposed' || p.status === 'approved');
  const sheet = { data, actions: {}, plan, work, ui: u, dispatch: sp.dispatch, engine: null, view: new ViewStore(), text, words, scope: {}, queue, queueAll: queue, current, nav: sp.nav, writes: sp.writes, onClose: () => {} } as unknown as Sheet;
  return <SheetContext.Provider value={sheet}>{children}</SheetContext.Provider>;
}

describe('the selection bar', () => {
  it('sends approve and every other batch move with exactly the picked ids', () => {
    const picked = [...byStatus('proposed').slice(0, 2), ...byStatus('done').slice(0, 1)].map((p) => p.id);
    expect(picked).toHaveLength(3);
    const sp = spies();
    render(<Host ui={{ selected: picked }} sp={sp}><SelBar /></Host>);
    expect(screen.getByTestId('blueprint-selbar').textContent).toContain('3');
    fireEvent.click(screen.getByTestId('blueprint-sel-approve'));
    expect(sp.writes.decideMany).toHaveBeenCalledWith(picked, 'approve');
    fireEvent.click(screen.getByTestId('blueprint-sel-decline'));
    expect(sp.writes.askMany).toHaveBeenCalledWith(picked, 'decline');
    fireEvent.click(screen.getByTestId('blueprint-sel-accept'));
    expect(sp.writes.askMany).toHaveBeenLastCalledWith(picked, 'accept');
    fireEvent.click(screen.getByTestId('blueprint-sel-rework'));
    expect(sp.writes.askMany).toHaveBeenLastCalledWith(picked, 'rework');
  });
  it('offers only the moves some picked status allows, and is absent with nothing picked', () => {
    const proposedOnly = byStatus('proposed').slice(0, 2);
    expect(batchMoves(proposedOnly)).toEqual(['approve', 'decline', 'descope']);
    const sp = spies();
    const { unmount } = render(<Host ui={{ selected: proposedOnly.map((p) => p.id) }} sp={sp}><SelBar /></Host>);
    expect(screen.queryByTestId('blueprint-sel-accept')).toBeNull();
    unmount();
    render(<Host ui={{ selected: [] }} sp={sp}><SelBar /></Host>);
    expect(screen.queryByTestId('blueprint-selbar')).toBeNull();
  });
});

describe('the decision card', () => {
  it('approves and declines the current waiting item through the single-item writes', () => {
    const p = byStatus('proposed')[0]!, sp = spies();
    render(<Host ui={{ itemId: p.id }} sp={sp}><DecisionCard /></Host>);
    const card = screen.getByTestId('blueprint-decision-card');
    expect(card.textContent).toContain(p.title);
    fireEvent.click(screen.getByTestId('blueprint-dc-approve'));
    expect(sp.writes.approve).toHaveBeenCalledWith(p);
    fireEvent.click(screen.getByTestId('blueprint-dc-decline'));
    expect(sp.writes.askDecline).toHaveBeenCalledWith(p);
    expect(screen.queryByTestId('blueprint-dc-build')).toBeNull();
  });
  it('offers accept and rework on a built item, build on an approved one, and stands aside under the L4 sheet', () => {
    const done = byStatus('done')[0]!, sp = spies();
    const { unmount } = render(<Host ui={{ itemId: done.id }} sp={sp}><DecisionCard /></Host>);
    fireEvent.click(screen.getByTestId('blueprint-dc-accept'));
    expect(sp.writes.askTriage).toHaveBeenCalledWith(done, 'accept');
    unmount();
    const ap = byStatus('approved')[0];
    if (ap) {
      const r = render(<Host ui={{ itemId: ap.id }} sp={sp}><DecisionCard /></Host>);
      fireEvent.click(screen.getByTestId('blueprint-dc-build'));
      expect(sp.writes.arm).toHaveBeenCalled();
      r.unmount();
    }
    render(<Host ui={{ itemId: done.id, sheet: done.fid }} sp={sp}><DecisionCard /></Host>);
    expect(screen.queryByTestId('blueprint-decision-card')).toBeNull();
  });
  it('stands beside its feature, flipping left at the safe edge and staying inside it', () => {
    const S = { l: 8, t: 80, r: 1000, b: 700 };
    expect(placeBeside({ x: 100, y: 300, w: 120, h: 80 }, S, 372, 300)).toEqual({ x: 236, y: 190 });
    expect(placeBeside({ x: 800, y: 300, w: 120, h: 80 }, S, 372, 300).x).toBe(800 - 372 - 16);
    expect(placeBeside({ x: 100, y: 0, w: 120, h: 40 }, S, 372, 300).y).toBe(80);
  });
});

describe('Shift+click on the plan', () => {
  function Hooks({ engine, sp, out }: { engine: Engine; sp: Spies; out: { h?: ReturnType<typeof useEngineHooks> } }) {
    out.h = useEngineHooks({ engine, plan, work, lens: 'general', nav: sp.nav as never, dispatch: sp.dispatch, tip: new TipStore() });
    return null;
  }
  it("picks the fixture's decidable items, and a second Shift+click drops them", () => {
    const fid = work.items.find((p) => p.status === 'proposed')!.fid, items = pickable(work, fid, 'general');
    expect(items.length).toBeGreaterThan(0);
    const sp = spies(), out: { h?: ReturnType<typeof useEngineHooks> } = {};
    const engine = { picked: [] as string[], cam: {} } as unknown as Engine;
    render(<Hooks engine={engine} sp={sp} out={out} />);
    out.h!.click(plan.L.TILE[fid]!, null, true);
    expect(sp.dispatch.mock.calls.map((c) => c[0])).toEqual(items.map((p) => ({ type: 'select', id: p.id })));
    sp.dispatch.mockClear();
    (engine as unknown as { picked: string[] }).picked = items.map((p) => p.id);
    out.h!.click(plan.L.TILE[fid]!, null, true);
    expect(sp.dispatch.mock.calls.map((c) => c[0])).toEqual(items.map((p) => ({ type: 'select', id: p.id })));
    expect(sp.nav.select).not.toHaveBeenCalled();
  });
});
