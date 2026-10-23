import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Every `t.section.key` resolves to the literal "section.key".
const t = new Proxy({}, { get: (_o, s) => new Proxy({}, { get: (_s, k) => `${String(s)}.${String(k)}` }) });
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => ({ t, tx: (s: unknown) => String(s) }) }));

const row = { projectId: 'p1', name: 'Alpha', past: [], future: [], undated: [], goals: [] };
const host = { lanesByProject: null as Map<string, never[]> | null };
vi.mock('../../shared/canvasHost', () => ({
  useProgressView: () => ({
    model: { rows: [row], hiddenIds: new Set() },
    canvas: { lanesByProject: host.lanesByProject, openMenu: vi.fn() },
    dl: {},
    createGoalIn: vi.fn(),
  }),
}));
vi.mock('../../shared/canvasParts', () => ({
  AddLaneButton: () => <i data-testid="add-lane" />,
  CanvasFrame: () => null,
  LaneChip: () => null,
  UnassignedLane: () => <i data-testid="unassigned" />,
}));
vi.mock('../../progressShared', () => ({ AddGoalButton: () => null, NODE_PX: 20 }));
vi.mock('../../shared/rowCanvas', () => ({ useMenuKey: () => ({ onKeyDown: vi.fn(), onContextMenu: vi.fn() }) }));

import { FilmstripCanvas } from '../FilmstripCanvas';

describe('FilmstripCanvas scope margin', () => {
  it('reserves the margin height while lanes load, then swaps in the real row', () => {
    host.lanesByProject = null;
    const { rerender } = render(<FilmstripCanvas leftWidth={120} />);
    const pending = screen.getByTestId('progress-lanes-pending-p1');
    expect(pending.style.minHeight).toBe('28px');
    expect(screen.queryByTestId('unassigned')).toBeNull();

    host.lanesByProject = new Map([['p1', []]]);
    rerender(<FilmstripCanvas leftWidth={120} />);
    expect(screen.queryByTestId('progress-lanes-pending-p1')).toBeNull();
    expect(screen.getByTestId('unassigned')).toBeTruthy();
  });
});
