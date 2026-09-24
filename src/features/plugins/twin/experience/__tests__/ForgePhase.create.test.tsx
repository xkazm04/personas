/**
 * Making a twin keeps the contract of the dialog it replaces — createTwinProfile
 * (with the languages it writes in) → setActiveTwin → RECORD the starting voice,
 * never run it here — and it keeps the layering the forge exists for: the ten
 * curated voices are one layer down, not in the main sight.
 *
 * The i18n layer is deliberately NOT mocked: the real catalog fails the moment
 * a key the surface reads does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const { order, createTwinProfile, setActiveTwin } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    createTwinProfile: vi.fn(async (name: string) => {
      order.push('create');
      return { id: 't7', name };
    }),
    setActiveTwin: vi.fn(async () => {
      order.push('activate');
    }),
  };
});

vi.mock('@/stores/systemStore', () => {
  const state = { createTwinProfile, setActiveTwin };
  const useSystemStore = <T,>(selector: (s: typeof state) => T): T => selector(state);
  return { useSystemStore };
});

import { ForgePhase } from '../forge/ForgePhase';
import { takePendingStyleStart } from '../../setup/style/pendingStyleStart';

beforeEach(() => {
  order.length = 0;
  createTwinProfile.mockClear();
  setActiveTwin.mockClear();
});

describe('the forge', () => {
  it('creates, activates, records the chosen voice, then deals the table', async () => {
    const onCreated = vi.fn();
    render(<ForgePhase onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('twin-experience-name'), { target: { value: '  Ada  ' } });
    fireEvent.click(screen.getByTestId('twin-experience-gender-female'));
    fireEvent.click(screen.getByTestId('twin-experience-language-cs'));
    fireEvent.click(screen.getByTestId('create-twin-style-choose'));
    fireEvent.click(await screen.findByTestId('create-twin-style-witty-wry'));
    fireEvent.click(screen.getByTestId('twin-experience-create'));

    // The app language starts selected; the picked one follows it.
    await waitFor(() =>
      expect(createTwinProfile).toHaveBeenCalledWith('Ada', undefined, undefined, '["en","cs"]', 'female'),
    );
    expect(setActiveTwin).toHaveBeenCalledWith('t7');
    expect(order).toEqual(['create', 'activate']);
    // Recorded for the voice layer to run, not run here.
    expect(takePendingStyleStart('t7')).toEqual({ kind: 'preset', presetId: 'witty-wry' });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ withStyle: true }));
  });

  it('keeps the ten voices one layer down, not in the main sight', async () => {
    render(<ForgePhase onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByTestId('create-twin-style-choose')).toBeInTheDocument();
    expect(screen.queryByTestId('create-twin-style-witty-wry')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('create-twin-style-choose'));
    expect(await screen.findByTestId('create-twin-style-witty-wry')).toBeInTheDocument();

    // Picking closes the picker, so the forge never grows a second scroller.
    fireEvent.click(screen.getByTestId('create-twin-style-witty-wry'));
    await waitFor(() =>
      expect(screen.queryByTestId('create-twin-style-witty-wry')).not.toBeInTheDocument(),
    );
  });

  it('with no starting voice, nothing is recorded', async () => {
    const onCreated = vi.fn();
    render(<ForgePhase onClose={vi.fn()} onCreated={onCreated} />);
    fireEvent.change(screen.getByTestId('twin-experience-name'), { target: { value: 'Ada' } });
    fireEvent.click(screen.getByTestId('twin-experience-create'));

    await waitFor(() => expect(createTwinProfile).toHaveBeenCalledTimes(1));
    expect(takePendingStyleStart('t7')).toBeNull();
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ withStyle: false }));
  });

  it('a nameless twin cannot be created', () => {
    render(<ForgePhase onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByTestId('twin-experience-create')).toBeDisabled();
  });
});
