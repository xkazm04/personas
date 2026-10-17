/**
 * Honest figures (lot B, direction 5): an absent value renders as absent, never as a calm or earlier one.
 *  - no reading before the proposal: there is no "before" (a later reading is never presented as one);
 *  - no risk: the decision card says "risk not stated", not the low-urgency word;
 *  - a lens nobody measured reads "not measured", apart from a clean lens;
 *  - a feature kind is words (unknown kinds spaced and lower-cased, never raw caps);
 *  - a wing and a room with the same name say it once.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { SheetContext, type Sheet } from '../controller/SheetContext';
import { useBlueprintText, useEngineWords } from '../controller/useBlueprintText';
import { kettleData } from '../fixture/kettle';
import { lensFigures } from '../model/counts';
import { buildPlan } from '../model/plan';
import { buildWork } from '../model/work';
import { initialUi, type UiState } from '../state/uiState';
import { ViewStore } from '../state/viewStore';
import { deltaText, kindWord, placeLine } from '../ui/format';
import { DecisionCard } from '../ui/overlays/DecisionCard';
import { PlanOverview } from '../ui/rail/panels/PlanOverview';
import { SheetHead } from '../ui/sheet/SheetHead';

const data = kettleData();
const plan = buildPlan(data.structure, data.events);

function Host({ ui, p = plan, work, children }: { ui?: Partial<UiState>; p?: typeof plan; work: ReturnType<typeof buildWork>; children: ReactNode }) {
  const text = useBlueprintText(), words = useEngineWords(text), u = { ...initialUi(), ...ui };
  const current = u.itemId ? work.byId.get(u.itemId) ?? null : null;
  const queue = work.items.filter((x) => x.status === 'proposed' || x.status === 'approved');
  const noop = vi.fn();
  const sheet = { data, actions: {}, plan: p, work, ui: u, dispatch: noop, engine: null, view: new ViewStore(), text, words, scope: {}, queue, queueAll: queue, current, nav: { select: noop, step: noop, openSheet: noop, toLevel: noop, closeSheet: noop }, writes: {}, onClose: noop } as unknown as Sheet;
  return <SheetContext.Provider value={sheet}>{children}</SheetContext.Provider>;
}

describe('a "before" with no earlier reading', () => {
  // one proposal that expects to move a metric, and one reading of that metric, taken at `at`
  const withReading = (at: string) => {
    const row = data.scan.proposals.find((p) => p.metric && p.expected_delta != null && plan.L.TILE[p.feature])!;
    const any = data.scan.measurements.find((m) => !m.phase)!;
    const reading = { ...any, feature: row.feature, lens: row.lens, metric: row.metric!, value: 7, measured_at: at };
    return buildWork(plan.L, { ...data.scan, proposals: [row], measurements: [reading] }).items[0]!;
  };

  it('is absent: a reading taken after the proposal is never printed as the before', () => {
    const item = withReading('2099-01-01T00:00:00.000Z');
    expect(item.before).toBeUndefined();
    expect(deltaText(plan, item, 'en')).not.toContain('→');
  });

  it('keeps the before when a reading exists at or before the proposal', () => {
    const item = withReading('2000-01-01T00:00:00.000Z');
    expect(item.before).toBe(7);
    expect(deltaText(plan, item, 'en')).toContain('→');
  });
});

describe('a missing risk', () => {
  it('reads "risk not stated" on the decision card, not "when you can"', () => {
    const work = buildWork(plan.L, data.scan), p = work.items.find((x) => x.status === 'proposed')!;
    const w2 = { ...work, byId: new Map(work.byId).set(p.id, { ...p, risk: undefined }) } as typeof work;
    render(<Host ui={{ itemId: p.id }} work={w2}><DecisionCard /></Host>);
    const kicker = screen.getByTestId('blueprint-decision-card').querySelector('.k span')!.textContent ?? '';
    expect(kicker).toContain('risk not stated');
    expect(kicker).not.toContain('when you can');
  });
});

describe('a lens nobody measured', () => {
  it('lensFigures tells measured from clean', () => {
    expect(lensFigures([], 'x').measured).toBe(false);
    const lens = plan.lenses[0]!.id;
    expect(lensFigures(plan.S.features, lens).measured).toBe(true);
    const bare = plan.S.features.map((f) => ({ ...f, lens: {} }));
    expect(lensFigures(bare, lens)).toEqual({ bad: 0, watch: 0, measured: false });
  });

  it('the Plan overview reads "not measured" for it, and counts for a measured one', () => {
    const gone = plan.lenses[0]!.id, kept = plan.lenses[1]!.id;
    const p2 = { ...plan, S: { ...plan.S, features: plan.S.features.map((f) => { const l = { ...f.lens }; delete l[gone]; return { ...f, lens: l }; }) } };
    render(<Host p={p2 as typeof plan} work={buildWork(plan.L, data.scan)}><PlanOverview /></Host>);
    const rows = [...document.querySelectorAll<HTMLElement>('.wb-kn li')];
    expect(rows[0]!.querySelector('.c')!.textContent).toBe('not measured');
    expect(rows[0]!.querySelector('.c')!.classList.contains('nm')).toBe(true);
    expect(rows.find((r) => r.textContent?.includes(plan.LENS[kept]!.short))!.querySelector('.c')!.textContent).toMatch(/\d+ bad · \d+ watch/);
  });
});

describe('words for a kind and a place', () => {
  const B = { kind_user_flow: 'User flow', kind_capability: 'Capability' } as Parameters<typeof kindWord>[0];
  it('maps a known kind and softens an unknown one', () => {
    expect(kindWord(B, 'user_flow')).toBe('User flow');
    expect(kindWord(B, 'BACKGROUND_JOB')).toBe('background job');
  });
  it('says a shared name once', () => {
    expect(placeLine('Scheduling', 'Scheduling')).toBe('Scheduling');
    expect(placeLine('Scheduling', 'Classes')).toBe('Scheduling · Classes');
  });
  it('the L4 kicker prints the kind in words', () => {
    const f = plan.S.features.find((x) => x.kind === 'user_flow')!;
    render(<Host work={buildWork(plan.L, data.scan)}><SheetHead fid={f.id} tabs={null} /></Host>);
    const k = document.querySelector('.pg-title .k')!.textContent ?? '';
    expect(k).toContain('User flow');
    expect(k).not.toContain('user_flow');
  });
});
