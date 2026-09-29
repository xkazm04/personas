/**
 * The Setup tab is a launch card and nothing more: arriving on it — by the
 * sidebar, a readiness jump, or a restart that restores the tab — must never
 * open the overlay. Only its two CTAs do, each naming the stage it opens on.
 *
 * The i18n layer is deliberately NOT mocked: the real catalog fails the moment
 * a key the card reads does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const { openTwinExperience } = vi.hoisted(() => ({ openTwinExperience: vi.fn() }));

vi.mock('../launcher', () => ({ openTwinExperience }));

vi.mock('@/stores/systemStore', () => {
  const state = {
    activeTwinId: 't1',
    twinProfiles: [{ id: 't1', name: 'Ada', pronouns: null, bio: '' }],
    twinTones: [],
    twinChannels: [],
    twinReadinessApproved: [],
  };
  const useSystemStore = <T,>(selector: (s: typeof state) => T): T => selector(state);
  return { useSystemStore };
});

import ExperienceSetupPage from '../ExperienceSetupPage';

beforeEach(() => openTwinExperience.mockClear());

describe('the Setup tab launch card', () => {
  it('never opens the overlay by being rendered', () => {
    const { rerender, unmount } = render(<ExperienceSetupPage />);
    rerender(<ExperienceSetupPage />);
    unmount();
    render(<ExperienceSetupPage />);
    expect(openTwinExperience).not.toHaveBeenCalled();
    expect(screen.getByTestId('twin-experience-launch')).toBeInTheDocument();
  });

  it('"Carry on setting up" opens the table on the setup stage', () => {
    render(<ExperienceSetupPage />);
    fireEvent.click(screen.getByTestId('twin-experience-launch-setup'));
    expect(openTwinExperience).toHaveBeenCalledTimes(1);
    expect(openTwinExperience).toHaveBeenCalledWith({ mode: 'train', stage: 'setup' });
  });

  it('"Start a training round" opens the table on the training stage', () => {
    render(<ExperienceSetupPage />);
    fireEvent.click(screen.getByTestId('twin-experience-launch-training'));
    expect(openTwinExperience).toHaveBeenCalledTimes(1);
    expect(openTwinExperience).toHaveBeenCalledWith({ mode: 'train', stage: 'training' });
  });
});
