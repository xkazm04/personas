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
      { responsibilityId: 'c1', passes: 12, avgCostUsd: 1.4, avgTokens: 1_400_000, peakRssMb: null, measuredEffort: 'xl' },
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-mismatch" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-mismatch');
    expect(screen.getByTestId('resp-profile-measured')).toHaveAttribute('data-mismatch', 'true');
    expect(screen.getByTestId('resp-profile-measured-band')).toHaveTextContent('XL');
  });

  it('a matching band is not a mismatch', async () => {
    getMeasured.mockResolvedValue([
      { responsibilityId: 'c1', passes: 3, avgCostUsd: 0.2, avgTokens: 90_000, peakRssMb: null, measuredEffort: 'm' },
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-match" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-measured-band');
    expect(screen.queryByTestId('resp-profile-mismatch')).toBeNull();
  });

  it('fleet-only passes (measuredEffort null) read as not measured', async () => {
    getMeasured.mockResolvedValue([
      { responsibilityId: 'c1', passes: 5, avgCostUsd: 0, avgTokens: 0, peakRssMb: null, measuredEffort: null },
    ]);
    render(<CharterResourceCard charter={charter(self)} personaId="p-fleet" onPatch={vi.fn()} />);
    await screen.findByTestId('resp-profile-not-measured');
    expect(screen.getByTestId('resp-profile-measured')).toHaveAttribute('data-mismatch', 'false');
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
