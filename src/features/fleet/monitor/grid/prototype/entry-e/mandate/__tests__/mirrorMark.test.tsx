// WP9: a mandate this device only mirrors says where it lives, in the board's
// device grammar ("On <device>"), and a verdict that waits for its home is a
// notice, never a failure toast. A mandate that lives here shows nothing new.

import { act, render, renderHook, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { MirrorChip, MirrorMark } from '../MirrorMark';
import { useMandateDoors } from '../useMandateDoors';

const suspendMandate = vi.fn();
vi.mock('@/api/mandates', () => ({
  suspendMandate: (...a: unknown[]) => suspendMandate(...a),
  resumeMandate: vi.fn(),
  revertCharterAct: vi.fn(),
  amendMandate: vi.fn(),
}));
const toast = vi.fn();
vi.mock('@/lib/silentCatch', () => ({
  toastCatch: () => toast,
  silentCatch: () => () => {},
}));

const MIRROR = { homePeerId: 'peer-desk', homeName: 'Desk', mirroredAt: '2026-10-15T10:00:00Z' };

function mandate(mirror: typeof MIRROR | null): MandateSummary {
  return {
    charterId: 'c1',
    title: 'App master for personas',
    projectId: 'proj',
    projectName: 'personas',
    stewardPersonaId: 'steward',
    stewardName: 'App Master',
    status: 'active',
    scopeRung: 3,
    source: 'kp-hire',
    envelope: { decideScopes: [], mergePolicy: 'never', budgetMonthlyUsd: 120, envelopeVersion: 2, keptAtActs: null },
    load: { spendUsedUsd: 40, budgetUsd: 120, actsCount: 12, openAsks: 1 },
    updatedAt: '2026-10-15T10:00:00Z',
    reread: null,
    origin: null,
    mirror,
  };
}

describe('the mirror marks', () => {
  it('names the home device on the title row and marks the row', () => {
    render(<><MirrorChip mirror={MIRROR} /><MirrorMark mirror={MIRROR} /></>);
    expect(screen.getByTestId('mandate-mirror').textContent).toContain('Desk');
    expect(screen.getByTestId('mandate-mirror-mark').getAttribute('aria-label')).toContain('Desk');
  });

  it('draws nothing for a mandate that lives here', () => {
    const { container } = render(<><MirrorChip mirror={null} /><MirrorMark mirror={undefined} /></>);
    expect(container.innerHTML).toBe('');
  });
});

describe('a door on a mirrored mandate', () => {
  beforeEach(() => { suspendMandate.mockReset(); toast.mockReset(); });

  it('says the verdict waits for its home instead of failing', async () => {
    suspendMandate.mockRejectedValue({ error: 'Sent home to "Desk".', kind: 'network_offline' });
    const { result } = renderHook(() => useMandateDoors(mandate(MIRROR), null, () => {}));
    await act(() => result.current.suspend());
    expect(result.current.notice).toContain('Desk');
    expect(toast).not.toHaveBeenCalled();
  });

  it('still toasts an unreachable device for a mandate that lives here', async () => {
    suspendMandate.mockRejectedValue({ error: 'offline', kind: 'network_offline' });
    const { result } = renderHook(() => useMandateDoors(mandate(null), null, () => {}));
    await act(() => result.current.suspend());
    expect(result.current.notice).toBeNull();
    expect(toast).toHaveBeenCalled();
  });
});
