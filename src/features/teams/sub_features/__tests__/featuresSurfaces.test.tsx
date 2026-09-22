/**
 * The two rendering rules a model of the data cannot see: an unmeasured score
 * must READ as "not measured" rather than as a zero, and a branch nobody has
 * ruled on must sit in its own strip rather than among the declared ones.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import type { BoardFeature } from '@/lib/bindings/BoardFeature';
import type { BoardScenario } from '@/lib/bindings/BoardScenario';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';

import { FeatureRowItem } from '../column/FeatureRowItem';
import { ScenariosPanel } from '../scenarios/ScenariosPanel';

const f = en.features;
// INVARIANT: these surfaces read only the `features` / `plugins.dev_tools`
// leaves, so the real English catalog is the catalog they would see at runtime.
const tDev = en.plugins.dev_tools as unknown as React.ComponentProps<typeof FeatureRowItem>['tDev'];
const tx = (template: string, vars: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

function council(over: Partial<CouncilSubjectState> = {}): CouncilSubjectState {
  return {
    id: 's1', projectId: 'p1', kind: 'use_case', useCaseId: 'f1', slug: 'f1', title: 'F1',
    state: 'none', tier: 'standard', roundNo: null, latestRunId: null, outcome: null,
    overall: null, coverage: null, trustState: null, floorHits: 0, hardFailures: 0,
    drift: 'none', projectName: 'P', registrySubjects: [], runDir: null,
    finishedAt: null, decidedAt: null, rejectionReason: null, ...over,
  };
}

function feature(over: Partial<BoardFeature> = {}): BoardFeature {
  return {
    id: 'f1', slug: 'f1', name: 'Feature one', description: null, kind: 'user_flow',
    tier: 'standard', contextIds: [], groupIds: [], primaryContextId: null,
    council: null, verdicts: [], history: [], scenarios: [], envelope: null,
    spend30dUsd: null, ...over,
  };
}

function scenario(over: Partial<BoardScenario> = {}): BoardScenario {
  return {
    id: 's', slug: 's', title: 'Declared branch', axes: {}, scope: 'must_hold',
    source: 'operator', floor: 0.7, latest: null, ...over,
  };
}

describe('a null score', () => {
  it('renders the words, and no zero anywhere on the row', () => {
    render(
      <FeatureRowItem
        row={{ feature: feature({ council: council({ overall: null }) }), kind: 'none', move: 'never', running: false, span: 0 }}
        totalGroups={4}
        selected={false}
        onSelect={vi.fn()}
        onOpen={vi.fn()}
        t={f}
        tDev={tDev}
        tx={tx}
        stateName={en.plugins.dev_tools.council_state_none}
      />,
    );
    const row = screen.getByTestId('features-row');
    expect(within(row).getByText(f.not_measured)).toBeTruthy();
    expect(row.textContent).not.toMatch(/\b0(\.0+)?\b/);
  });
});

describe('the scenarios panel', () => {
  const base = feature({
    scenarios: [
      scenario({ id: 'a', slug: 'a', title: 'Declared branch' }),
      scenario({ id: 'p', slug: 'p', title: 'Branch the council found', scope: 'proposed', floor: 0.5 }),
    ],
    envelope: { holds: [], weak: [], unmeasured: ['a'], outOfScope: [], proposed: ['p'] },
  });

  function renderPanel(over: Partial<BoardFeature> = {}) {
    render(
      <ScenariosPanel
        feature={{ ...base, ...over }}
        onUpsert={vi.fn().mockResolvedValue(undefined)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        t={f}
        tCommon={{ save: en.common.save, cancel: en.common.cancel, delete: en.common.delete }}
        tx={tx}
        language="en"
      />,
    );
  }

  it('keeps a proposed branch in its own strip, out of the declared cells', () => {
    renderPanel();
    const strip = screen.getByTestId('features-proposed');
    expect(within(strip).getByText('Branch the council found')).toBeTruthy();
    expect(within(strip).getByText(f.adopt_must_hold)).toBeTruthy();
    expect(within(strip).getByText(f.dismiss)).toBeTruthy();

    const cells = screen.getAllByTestId('features-scenario-cell');
    expect(cells).toHaveLength(1);
    expect(cells[0]?.getAttribute('data-scenario-scope')).toBe('must_hold');
  });

  it('draws the envelope from the board, counts and all', () => {
    renderPanel();
    const envelope = screen.getByTestId('features-envelope');
    expect(envelope.textContent).toContain(tx(f.envelope_unmeasured, { count: 1 }));
    expect(envelope.textContent).toContain(tx(f.envelope_holds, { count: 0 }));
  });

  it('says nothing has been measured when the board carries no envelope', () => {
    // No envelope is NOT an empty envelope: the panel must not fold one of its
    // own to fill the line.
    renderPanel({ envelope: null });
    expect(screen.getByTestId('features-envelope').textContent).toBe(f.envelope_none);
  });
});
