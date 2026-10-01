/**
 * A forge opened from Browser > Learn > "New twin" carries a writing sample:
 * after create + activate, the NEW twin learns from it, recorded with source
 * kind `forge` (the original host rides along), fire-and-forget so a failed
 * analysis never fails the create. A forge opened without a seed learns
 * nothing.
 *
 * The i18n layer is NOT mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => {
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
    learnFromSample: vi.fn(async () => {
      order.push('learn');
      return { id: 's1' };
    }),
  };
});

vi.mock('@/stores/systemStore', () => {
  const state = { createTwinProfile: h.createTwinProfile, setActiveTwin: h.setActiveTwin };
  const useSystemStore = <T,>(selector: (s: typeof state) => T): T => selector(state);
  return { useSystemStore };
});

vi.mock('@/api/twin/twinSample', () => ({ learnFromSample: h.learnFromSample }));

import { ForgePhase } from '../forge/ForgePhase';
import { closeTwinExperience, openTwinExperience } from '../launcher';

beforeEach(() => {
  h.order.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  closeTwinExperience();
});

async function forge(name: string) {
  const onCreated = vi.fn();
  render(<ForgePhase onClose={vi.fn()} onCreated={onCreated} />);
  fireEvent.change(screen.getByTestId('twin-experience-name'), { target: { value: name } });
  fireEvent.click(screen.getByTestId('twin-experience-create'));
  await waitFor(() => expect(onCreated).toHaveBeenCalled());
}

describe('the forge with a seed sample', () => {
  it('creates, activates, then the new twin learns from the sample as a forge sample', async () => {
    openTwinExperience({
      mode: 'create',
      seedSample: { text: 'How I really write.', sourceKind: 'selection', sourceHost: 'mail.example.com' },
    });
    await forge('Ada');

    expect(h.learnFromSample).toHaveBeenCalledWith('t7', 'How I really write.', 'forge', 'mail.example.com');
    expect(h.order).toEqual(['create', 'activate', 'learn']);
  });

  it('a failed analysis start does not fail the create', async () => {
    h.learnFromSample.mockRejectedValueOnce(new Error('not built yet'));
    openTwinExperience({ mode: 'create', seedSample: { text: 'sample', sourceKind: 'clipboard', sourceHost: null } });
    await forge('Ada');
    expect(h.learnFromSample).toHaveBeenCalledWith('t7', 'sample', 'forge', null);
  });

  it('without a seed nothing is learned', async () => {
    openTwinExperience({ mode: 'create' });
    await forge('Ada');
    expect(h.learnFromSample).not.toHaveBeenCalled();
  });
});
