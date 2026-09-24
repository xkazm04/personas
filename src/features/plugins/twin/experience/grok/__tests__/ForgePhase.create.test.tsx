import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const createTwinProfile = vi.fn();
const setActiveTwin = vi.fn();
const store = {
  createTwinProfile,
  setActiveTwin,
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof store) => unknown) => selector(store),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: T,
    tx: (s: string) => s,
    language: 'en',
  }),
}));

const T = {
  twin: {
    identity: { genderMale: 'Male', genderFemale: 'Female', genderNeutral: 'Neutral' },
    profiles: { cancel: 'Cancel' },
    style: {
      presets: new Proxy(
        {},
        { get: (_t, id) => ({ name: String(id), summary: 's' }) },
      ),
    },
    experience_grok: {
      close: 'Close',
      forge: {
        eyebrow: 'New twin',
        title: 'Who should this twin be?',
        subtitle: 'A name is enough.',
        name: 'Name',
        namePlaceholder: 'Name',
        gender: 'Gender',
        style: 'Style',
        styleHint: 'hint',
        styleSkip: 'Skip',
        styleSkipHint: 'later',
        styleSurprise: 'Surprise',
        styleSurpriseHint: 'roll',
        styleChoose: 'Choose a voice',
        styleChooseHint: 'ten voices',
        create: 'Deal',
        creating: 'Creating',
        hint: 'hint',
      },
    },
  },
};

import { ForgePhase } from '../forge/ForgePhase';
import { takePendingStyleStart } from '../../../setup/style/pendingStyleStart';

describe('ForgePhase create contract', () => {
  beforeEach(() => {
    createTwinProfile.mockReset();
    setActiveTwin.mockReset();
    createTwinProfile.mockResolvedValue({ id: 'twin-1' });
    setActiveTwin.mockResolvedValue(undefined);
  });

  it('creates the twin, activates it, then continues without closing', async () => {
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<ForgePhase onClose={onClose} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('twin-experience-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('twin-experience-create'));

    await waitFor(() => expect(createTwinProfile).toHaveBeenCalledTimes(1));
    expect(createTwinProfile).toHaveBeenCalledWith('Ada', undefined, undefined, undefined, 'neutral');
    expect(setActiveTwin).toHaveBeenCalledWith('twin-1');
    expect(onCreated).toHaveBeenCalledWith({ withStyle: false });
    expect(onClose).not.toHaveBeenCalled();
    expect(takePendingStyleStart('twin-1')).toBeNull();
  });

  it('records a pending style start when a preset is chosen one layer down', async () => {
    const onCreated = vi.fn();
    render(<ForgePhase onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('twin-experience-name'), { target: { value: 'Ada' } });
    // The ten presets are NOT in the main sight — they live behind the third tile.
    expect(screen.queryByTestId('create-twin-style-executive-brief')).toBeNull();
    fireEvent.click(screen.getByTestId('create-twin-style-choose'));
    fireEvent.click(await screen.findByTestId('create-twin-style-executive-brief'));
    // Picking closes the picker and lifts the choice into the main sight.
    await waitFor(() =>
      expect(screen.queryByTestId('create-twin-style-executive-brief')).toBeNull(),
    );
    fireEvent.click(screen.getByTestId('twin-experience-create'));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ withStyle: true }));
    expect(takePendingStyleStart('twin-1')).toEqual({ kind: 'preset', presetId: 'executive-brief' });
  });
});
