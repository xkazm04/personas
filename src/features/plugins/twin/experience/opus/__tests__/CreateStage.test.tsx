/**
 * Creating a twin keeps the contract of the dialog it replaces:
 * createTwinProfile → setActiveTwin → record the starting style (never run it
 * here), then hand over to the table.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { order, createTwinProfile, setActiveTwin } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    createTwinProfile: vi.fn(async (name: string) => {
      order.push('create');
      return { id: 't9', name };
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

import { CreateStage } from '../create/CreateStage';
import { takePendingStyleStart } from '../../../setup/style/pendingStyleStart';

beforeEach(() => {
  order.length = 0;
  createTwinProfile.mockClear();
  setActiveTwin.mockClear();
});

describe('making a twin', () => {
  it('creates, activates, records the chosen style, then deals the table', async () => {
    const onCreated = vi.fn();
    render(<CreateStage onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('xo-create-name'), { target: { value: '  Ada  ' } });
    fireEvent.click(screen.getByTestId('xo-create-sigil-female'));
    fireEvent.click(screen.getByTestId('xo-create-language-cs'));
    fireEvent.click(screen.getByTestId('xo-create-style-witty-wry'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('xo-create-submit'));
    });

    // The app language starts selected; the picked one follows it.
    expect(createTwinProfile).toHaveBeenCalledWith('Ada', undefined, undefined, '["en","cs"]', 'female');
    expect(setActiveTwin).toHaveBeenCalledWith('t9');
    expect(order).toEqual(['create', 'activate']);
    // Recorded for the table to run, not run here.
    expect(takePendingStyleStart('t9')).toEqual({ kind: 'preset', presetId: 'witty-wry' });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('with no starting style, nothing is recorded', async () => {
    render(<CreateStage onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByTestId('xo-create-name'), { target: { value: 'Ada' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('xo-create-name'), { key: 'Enter' });
    });
    expect(createTwinProfile).toHaveBeenCalledTimes(1);
    expect(takePendingStyleStart('t9')).toBeNull();
  });

  it('a nameless twin cannot be created', async () => {
    render(<CreateStage onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('xo-create-submit'));
    });
    expect(createTwinProfile).not.toHaveBeenCalled();
  });
});
