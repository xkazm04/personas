import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PersonaResponsibility } from '@/lib/bindings/PersonaResponsibility';
import type { ResourceProfile } from '@/lib/bindings/ResourceProfile';
import type { ResponsibilityMeasured } from '@/lib/bindings/ResponsibilityMeasured';

const getMeasured = vi.fn<(personaId: string) => Promise<ResponsibilityMeasured[]>>();
vi.mock('@/api/agents/responsibilityMeasured', () => ({
  getResponsibilityMeasured: (personaId: string) => getMeasured(personaId),
}));

import { CharterResourceCard } from '../components/CharterResourceCard';
import { measuredCache } from '../libs/useCharterMeasured';

function charter(resourceProfile?: ResourceProfile): PersonaResponsibility {
  // Test fixture: the card reads only `id` and `spec`.
  return { id: 'c1', title: 'Ship the build', spec: resourceProfile ? { resourceProfile } : {} } as PersonaResponsibility;
}

const self: ResourceProfile = {
  machine: 'heavy',
  gpu: 'none',
  difficulty: 'hard',
  effort: 'm',
  source: 'self',
  pinned: false,
  rationale: 'compiles rust',
  declaredAt: '2026-09-17T10:00:00Z',
};

/** A measured row; the resource fields default to "no resource run yet". */
const row = (over: Partial<ResponsibilityMeasured>): ResponsibilityMeasured => ({
  responsibilityId: 'c1', passes: 0, avgCostUsd: 0, avgTokens: 0, peakRssMb: null, measuredEffort: null,
  resourceRuns: 0, resourceRunsRequired: 5, cpuP95Share: null, ramPeakShare: null, gpuP95Share: null, dominant: null,
  measuredMachine: null, measuredGpu: null, ...over,
});

const checked = (testId: string) => screen.getByTestId(testId).getAttribute('aria-checked');

beforeEach(() => {
  measuredCache.clear();
  getMeasured.mockReset();
  getMeasured.mockResolvedValue([]);
});

describe('CharterResourceCard', () => {
  it('default: shows the default tags and the untagged note, nothing to save', async () => {
    render(<CharterResourceCard charter={charter()} personaId="p-default" onPatch={vi.fn()} />);
    expect(screen.getByTestId('resp-profile-untagged')).toBeInTheDocument();
    expect(checked('resp-profile-machine-light')).toBe('true');
    expect(checked('resp-profile-effort-m')).toBe('true');
    expect(screen.getByTestId('resp-profile-save')).toBeDisabled();
    await screen.findByTestId('resp-profile-not-measured');
  });

  it('self-declared: shows the stored tags, no untagged note, pin off', async () => {
    render(<CharterResourceCard charter={charter(self)} personaId="p-self" onPatch={vi.fn()} />);
    expect(screen.queryByTestId('resp-profile-untagged')).toBeNull();
    expect(checked('resp-profile-machine-heavy')).toBe('true');
    expect(screen.getByTestId('resp-profile-pin')).toHaveAttribute('aria-checked', 'false');
    await screen.findByTestId('resp-profile-not-measured');
  });

  it('pinned: the pin is on; unpinning saves pinned:false', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(
      <CharterResourceCard
        charter={charter({ ...self, source: 'operator', pinned: true })}
        personaId="p-pinned"
        onPatch={onPatch}
      />,
    );
    const pin = screen.getByTestId('resp-profile-pin');
    expect(pin).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(pin);
    fireEvent.click(screen.getByTestId('resp-profile-save'));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![0].spec.resourceProfile).toMatchObject({ pinned: false, machine: 'heavy' });
  });

  it('editing a tag pins the draft and the save carries it', async () => {
    const onPatch = vi.fn().mockResolvedValue(undefined);
    render(<CharterResourceCard charter={charter(self)} personaId="p-edit" onPatch={onPatch} />);
    fireEvent.click(screen.getByTestId('resp-profile-effort-xl'));
    expect(screen.getByTestId('resp-profile-pin')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('resp-profile-save'));
    await waitFor(() => expect(onPatch).toHaveBeenCalledTimes(1));
    expect(onPatch.mock.calls[0]![0].spec.resourceProfile).toMatchObject({ effort: 'xl', pinned: true });
  });

  it('highlights a measured band that differs from the declared one', async () => {
    getMeasured.mockResolvedValue([
      row({ passes: 12, avgCostUsd: 1.4, avgTokens: 1_400_000, measuredEffort: 'xl' }),
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-mismatch" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-mismatch');
    expect(screen.getByTestId('resp-profile-measured')).toHaveAttribute('data-mismatch', 'true');
    expect(screen.getByTestId('resp-profile-measured-band')).toHaveTextContent('XL');
  });

  it('a matching band is not a mismatch', async () => {
    getMeasured.mockResolvedValue([
      row({ passes: 3, avgCostUsd: 0.2, avgTokens: 90_000, measuredEffort: 'm' }),
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-match" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-measured-band');
    expect(screen.queryByTestId('resp-profile-mismatch')).toBeNull();
  });

  it('fleet-only passes (measuredEffort null) read as not measured', async () => {
    getMeasured.mockResolvedValue([
      row({ passes: 5 }),
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-fleet" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-not-measured');
    expect(screen.getByTestId('resp-profile-measured')).toHaveAttribute('data-mismatch', 'false');
  });

  it('measured load: three bars over the runs, "learning" before the loop can act', async () => {
    getMeasured.mockResolvedValue([
      row({ resourceRuns: 3, cpuP95Share: 0.42, ramPeakShare: 0.18, gpuP95Share: null, dominant: 'cpu' }),
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-learning" onPatch={vi.fn()} />);
    const axes = await screen.findByTestId('resp-profile-axes');
    expect(axes).toHaveAttribute('data-learning', 'true');
    expect(screen.getByTestId('resp-profile-axes-runs')).toHaveTextContent('Learning (3/5)');
    // A null GPU draws no bar.
    expect(screen.getByTestId('resp-profile-axes-bars').querySelectorAll('[data-axis]')).toHaveLength(2);
  });

  it('measured over enough runs, unpinned: no mismatch badge even when the tags differ', async () => {
    getMeasured.mockResolvedValue([
      row({ resourceRuns: 8, cpuP95Share: 0.7, ramPeakShare: 0.2, gpuP95Share: 0.3, dominant: 'cpu', measuredMachine: 'exclusive', measuredGpu: 'shared' }),
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-runs" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-axes');
    expect(screen.getByTestId('resp-profile-axes-runs')).toHaveTextContent('Measured over 8 runs');
    expect(screen.queryByTestId('resp-profile-axes-mismatch')).toBeNull();
  });

  it('a pinned profile the measurement disagrees with gets a badge naming both values', async () => {
    getMeasured.mockResolvedValue([
      row({ resourceRuns: 6, cpuP95Share: 0.7, ramPeakShare: 0.2, gpuP95Share: 0.01, dominant: 'cpu', measuredMachine: 'exclusive', measuredGpu: 'none' }),
    ]);
    render(<CharterResourceCard charter={charter({ ...self, pinned: true })} personaId="p-pin-mismatch" onPatch={vi.fn()} />);
    const badge = await screen.findByTestId('resp-profile-axes-mismatch');
    // machine differs (heavy -> exclusive); gpu agrees (none) and is not named.
    expect(badge).toHaveTextContent('Measured Exclusive, declared Heavy');
  });

  it('an operator profile whose measured tags agree gets no badge', async () => {
    getMeasured.mockResolvedValue([
      row({ resourceRuns: 6, cpuP95Share: 0.3, ramPeakShare: 0.2, dominant: 'cpu', measuredMachine: 'heavy', measuredGpu: 'none' }),
    ]);
    render(<CharterResourceCard charter={charter({ ...self, source: 'operator' })} personaId="p-op-match" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-axes');
    expect(screen.queryByTestId('resp-profile-axes-mismatch')).toBeNull();
  });

  it("a profile the loop set reads as measured, not as the operator's", async () => {
    render(<CharterResourceCard charter={charter({ ...self, source: 'measured' })} personaId="p-src" onPatch={vi.fn()} />);
    expect(screen.getByTestId('resp-profile-source')).toHaveTextContent('set from measured runs');
    await screen.findByTestId('resp-profile-not-measured');
  });

  it('fetches once per persona: a second mount paints from the warm cache', async () => {
    const first = render(<CharterResourceCard charter={charter(self)} personaId="p-warm" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-not-measured');
    first.unmount();
    render(<CharterResourceCard charter={charter(self)} personaId="p-warm" onPatch={vi.fn()} />);
    expect(screen.queryByTestId('resp-profile-measured-ghost')).toBeNull();
    expect(getMeasured).toHaveBeenCalledTimes(1);
  });
});
