import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { CreateTriggerForm } from './CreateTriggerForm';
import type { Persona } from '@/lib/types/types';

const cloudCreateTrigger = vi.hoisted(() => vi.fn());
const toastCatchInner = vi.hoisted(() => vi.fn());
const toastCatch = vi.hoisted(() => vi.fn((_ctx: string) => toastCatchInner));

vi.mock('@/api/system/cloud', () => ({ cloudCreateTrigger }));
vi.mock('@/lib/silentCatch', async (orig) => ({ ...(await orig<typeof import('@/lib/silentCatch')>()), toastCatch }));

const personas = [{ id: 'p1', name: 'Alpha' }] as unknown as Persona[];

function setup() {
  const onCreated = vi.fn();
  render(<CreateTriggerForm deployedPersonas={personas} onCreated={onCreated} onCancel={() => {}} />);
  fireEvent.change(screen.getByLabelText(/Persona/), { target: { value: 'p1' } });
  return { onCreated };
}

const createButton = () => screen.getByRole('button', { name: /Create Trigger/ });

describe('CreateTriggerForm', () => {
  beforeEach(() => {
    cloudCreateTrigger.mockReset();
    toastCatchInner.mockReset();
    toastCatch.mockClear();
  });

  it('disables Create and shows an inline error while the cron is not a 5-field expression', () => {
    setup();
    expect(createButton()).not.toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Cron Expression/), { target: { value: '0 * * *' } });
    expect(createButton()).toBeDisabled();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(createButton());
    expect(cloudCreateTrigger).not.toHaveBeenCalled();
  });

  it('routes a failed create through toastCatch', async () => {
    const boom = new Error('orchestrator said no');
    cloudCreateTrigger.mockRejectedValueOnce(boom);
    const { onCreated } = setup();
    await act(async () => { fireEvent.click(createButton()); });
    expect(toastCatch).toHaveBeenCalledWith('CreateTriggerForm:create');
    expect(toastCatchInner).toHaveBeenCalledWith(boom);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
