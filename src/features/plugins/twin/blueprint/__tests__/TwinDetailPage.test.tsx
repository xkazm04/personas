/**
 * The Twin Detail page (the `setup` tab). Arriving on it never opens the
 * overlay and never opens a setup session (a session open can start a paid
 * plan); only its two CTAs open the experience, each naming its stage. The
 * blueprint is the selected variant in detail mode under one declared panel;
 * L3 opens when the variant asks for a section's detail, and Escape closes
 * the drawer first, then the zoom.
 *
 * The i18n layer is NOT mocked: the real catalog fails the moment a seeded key
 * the page reads does not exist. The variant renderers are replaced with one
 * probe, because they are other packages' work and lazy chunks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { BlueprintVariantProps } from '../blueprintContract';

const { openTwinExperience, setupGet, setupOpen, sampleProposals, setTwinTab } = vi.hoisted(() => ({
  openTwinExperience: vi.fn(),
  setupGet: vi.fn(),
  setupOpen: vi.fn(),
  sampleProposals: vi.fn(),
  setTwinTab: vi.fn(),
}));

vi.mock('../../experience/launcher', () => ({ openTwinExperience, useTwinExperienceRequest: () => null }));
vi.mock('@/api/twin/twinSetup', () => ({ setupGet, setupOpen }));
vi.mock('@/api/twin/twinSample', () => ({ sampleProposals }));
vi.mock('@/api/twin/twin', () => ({
  listPendingMemories: vi.fn().mockResolvedValue([]),
  listDistilledFacts: vi.fn().mockResolvedValue([]),
  listCommunications: vi.fn().mockResolvedValue([]),
}));
vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, silentCatch: () => () => {}, toastCatch: () => () => {} };
});

function ProbeVariant({ mode, focus, onFocus, onOpenDetail }: BlueprintVariantProps) {
  return (
    <div data-testid="twin-test-variant" data-mode={mode} data-focus={focus ?? 'overview'}>
      <button type="button" onClick={() => onFocus('voice')}>zoom</button>
      <button type="button" onClick={() => onOpenDetail('voice', 'generic')}>detail</button>
    </div>
  );
}
vi.mock('../variantRegistry', () => ({
  BLUEPRINT_VARIANTS: {
    drafting: ProbeVariant,
    strata: ProbeVariant,
  },
}));

const state = {
  activeTwinId: 't1',
  twinProfiles: [
    { id: 't1', name: 'Ada', slug: 'ada', bio: '', role: 'Founder', languages: null, pronouns: null, obsidian_subpath: 'personas/twins/ada', is_active: true, knowledge_base_id: null, training_directives: null, created_at: '', updated_at: '' },
  ],
  twinTones: [],
  twinChannels: [],
  twinReadinessApproved: [],
  setTwinTab,
};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: <T,>(selector: (s: typeof state) => T): T => selector(state),
}));

import TwinDetailPage from '../TwinDetailPage';

const SNAPSHOT = {
  twinId: 't1', stage: 'setup', topicPreset: null, focusSlot: null, planStatus: 'ready', planVersion: 1, planError: null, changeNote: null,
  goals: [], live: null, upcoming: [], transcript: [], offers: [], lastAnswerOfferIds: [], observations: [], planning: false, reconciling: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  setupGet.mockResolvedValue(SNAPSHOT);
  sampleProposals.mockRejectedValue(new Error('not built'));
});

describe('the Twin Detail page', () => {
  it('never opens the overlay, nor a setup session, by being rendered', async () => {
    const { rerender, unmount } = render(<TwinDetailPage />);
    rerender(<TwinDetailPage />);
    unmount();
    render(<TwinDetailPage />);
    await screen.findByTestId('twin-test-variant');
    expect(openTwinExperience).not.toHaveBeenCalled();
    expect(setupOpen).not.toHaveBeenCalled();
    expect(setupGet).toHaveBeenCalledWith('t1');
    expect(screen.getByTestId('twin-experience-launch')).toBeInTheDocument();
  });

  it('"Carry on setting up" opens the table on the setup stage', () => {
    render(<TwinDetailPage />);
    fireEvent.click(screen.getByTestId('twin-experience-launch-setup'));
    expect(openTwinExperience).toHaveBeenCalledTimes(1);
    expect(openTwinExperience).toHaveBeenCalledWith({ mode: 'train', stage: 'setup' });
  });

  it('"Train" opens the table on the training stage', () => {
    render(<TwinDetailPage />);
    fireEvent.click(screen.getByTestId('twin-experience-launch-training'));
    expect(openTwinExperience).toHaveBeenCalledTimes(1);
    expect(openTwinExperience).toHaveBeenCalledWith({ mode: 'train', stage: 'training' });
  });

  it('draws the selected variant in detail mode inside the panel the switcher controls', async () => {
    render(<TwinDetailPage />);
    const variant = await screen.findByTestId('twin-test-variant');
    expect(variant).toHaveAttribute('data-mode', 'detail');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toContainElement(variant);
    expect(document.getElementById(panel.getAttribute('aria-labelledby') ?? '')).toHaveAttribute('role', 'tab');
  });

  it('opens L3 when the variant asks; Escape closes the drawer first, then the zoom', async () => {
    render(<TwinDetailPage />);
    await screen.findByTestId('twin-test-variant');
    fireEvent.click(screen.getByText('zoom'));
    expect(screen.getByTestId('twin-test-variant')).toHaveAttribute('data-focus', 'voice');

    fireEvent.click(screen.getByText('detail'));
    expect(await screen.findByTestId('twin-detail-drawer-voice')).toBeInTheDocument();
    expect(screen.getByTestId('twin-detail-voice-generic')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('twin-detail-drawer-voice')).not.toBeInTheDocument());
    expect(screen.getByTestId('twin-test-variant')).toHaveAttribute('data-focus', 'voice');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByTestId('twin-test-variant')).toHaveAttribute('data-focus', 'overview');
  });

  it('"Edit in setup" opens the experience at the door that edits the section', async () => {
    render(<TwinDetailPage />);
    await screen.findByTestId('twin-test-variant');
    fireEvent.click(screen.getByText('detail'));
    fireEvent.click(await screen.findByTestId('twin-detail-edit-in-setup'));
    expect(openTwinExperience).toHaveBeenCalledWith({ mode: 'train', stage: 'setup', door: 'studio' });
  });

  it('shows the proposals chip only when proposals are open, and it leads to the Hub', async () => {
    const { unmount } = render(<TwinDetailPage />);
    await screen.findByTestId('twin-test-variant');
    expect(screen.queryByTestId('twin-detail-proposals')).not.toBeInTheDocument();
    unmount();

    sampleProposals.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    render(<TwinDetailPage />);
    const chip = await screen.findByTestId('twin-detail-proposals');
    expect(chip).toHaveTextContent('3');
    fireEvent.click(chip);
    expect(setTwinTab).toHaveBeenCalledWith('hub');
  });
});
