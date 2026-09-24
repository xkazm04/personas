/**
 * Act one keeps the contract of the dialog it replaces — createTwinProfile →
 * setActiveTwin → RECORD the starting voice, never run it here — and it keeps
 * the rule this whole variant exists for: the first sight is one question, and
 * everything else is a layer down.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const { order, createTwinProfile, setActiveTwin } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    createTwinProfile: vi.fn(async (name: string) => {
      order.push('create');
      return { id: 'm7', name };
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

import { CreateAct } from '../create/CreateAct';
import { takePendingStyleStart } from '../../../setup/style/pendingStyleStart';

beforeEach(() => {
  order.length = 0;
  createTwinProfile.mockClear();
  setActiveTwin.mockClear();
});

describe('naming a twin', () => {
  it('shows one question first, and nothing else until it is answered', () => {
    render(<CreateAct onClose={vi.fn()} onCreated={vi.fn()} />);

    // Before a name there is a field and no way on — the act has not earned
    // the next beat yet.
    expect(screen.getByTestId('mr-create-name')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-create-sigil')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mr-create-begin')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('mr-create-name'), { target: { value: 'Ada' } });

    expect(screen.getByTestId('mr-create-sigil')).toBeInTheDocument();
    expect(screen.getByTestId('mr-create-begin')).toBeInTheDocument();
  });

  it('keeps the languages and the ten voices one layer down, not in the lane', () => {
    render(<CreateAct onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByTestId('mr-create-name'), { target: { value: 'Ada' } });

    // Closed: the door is visible, its contents are not.
    expect(screen.getByTestId('mr-create-options')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-create-languages')).not.toBeInTheDocument();
    expect(screen.queryByTestId('mr-create-style-witty-wry')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('mr-create-options'));

    expect(screen.getByTestId('mr-create-languages')).toBeInTheDocument();
    expect(screen.getByTestId('mr-create-style-witty-wry')).toBeInTheDocument();
  });

  it('creates, activates, records the chosen voice, then hands over to the lane', async () => {
    const onCreated = vi.fn();
    render(<CreateAct onClose={vi.fn()} onCreated={onCreated} />);

    fireEvent.change(screen.getByTestId('mr-create-name'), { target: { value: '  Ada  ' } });
    fireEvent.click(screen.getByTestId('mr-create-sigil-female'));
    fireEvent.click(screen.getByTestId('mr-create-options'));
    fireEvent.click(screen.getByTestId('mr-create-language-cs'));
    fireEvent.click(screen.getByTestId('mr-create-style-witty-wry'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('mr-create-begin'));
    });

    // The app language starts selected; the picked one follows it.
    expect(createTwinProfile).toHaveBeenCalledWith('Ada', undefined, undefined, '["en","cs"]', 'female');
    expect(setActiveTwin).toHaveBeenCalledWith('m7');
    expect(order).toEqual(['create', 'activate']);
    // Recorded for the stage's voice layer to run, not run here.
    expect(takePendingStyleStart('m7')).toEqual({ kind: 'preset', presetId: 'witty-wry' });
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it('Enter in the field is the same as Begin, and records no voice when none was chosen', async () => {
    render(<CreateAct onClose={vi.fn()} onCreated={vi.fn()} />);
    fireEvent.change(screen.getByTestId('mr-create-name'), { target: { value: 'Ada' } });
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('mr-create-name'), { key: 'Enter' });
    });
    expect(createTwinProfile).toHaveBeenCalledTimes(1);
    expect(takePendingStyleStart('m7')).toBeNull();
  });

  it('a nameless twin cannot be created — Enter does nothing', async () => {
    render(<CreateAct onClose={vi.fn()} onCreated={vi.fn()} />);
    await act(async () => {
      fireEvent.keyDown(screen.getByTestId('mr-create-name'), { key: 'Enter' });
    });
    expect(createTwinProfile).not.toHaveBeenCalled();
  });
});
