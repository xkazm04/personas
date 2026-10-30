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
    expect((createButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.change(screen.getByLabelText(/Cron Expression/), { target: { value: '0 * * *' } });
    expect((createButton() as HTMLButtonElement).disabled).toBe(true);
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

describe('CreateTriggerForm selection is exposed, not colour-only', () => {
  it('names the trigger-type group and marks the chosen type and preset pressed', () => {
    render(<CreateTriggerForm deployedPersonas={personas} onCreated={() => {}} onCancel={() => {}} />);
    const group = screen.getByRole('group', { name: 'Trigger Type' });
    const schedule = group.querySelector('button[aria-pressed="true"]');
    expect(schedule?.textContent).toContain('Schedule (cron)');
    const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
    expect(pressed('Webhook')).toBe('false');

    // 2 type toggles + 8 cron presets, every one with a pressed state.
    const toggles = Array.from(document.querySelectorAll('button[aria-pressed]'));
    expect(toggles).toHaveLength(10);
    // The default cron '0 * * * *' is the "Every hour" preset.
    expect(pressed('Every hour')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Every 5 min' }));
    expect(pressed('Every 5 min')).toBe('true');
    expect(pressed('Every hour')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Webhook' }));
    expect(pressed('Webhook')).toBe('true');
  });
});
