import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// The knob labels are translated; the prompts they send are instructions to
// the model and stay English.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { studio: new Proxy({}, { get: (_, k) => String(k) }) }, tx: (s: string) => s }),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@/api/webbuild', () => ({ webbuildSessionSend: vi.fn(() => new Promise(() => {})) }));

const { useStudioStore } = await import('../studioStore');
const StudioDesignKnobs = (await import('../StudioDesignKnobs')).default;

afterEach(cleanup);

describe('design knobs', () => {
  it('label every dial and option through i18n and send an English instruction', () => {
    const sendTurn = vi.fn();
    useStudioStore.setState({ sendTurn } as never);
    render(<StudioDesignKnobs id="p1" />);
    for (const k of ['knob_spacing', 'knob_corners', 'knob_type', 'knob_vibe']) expect(screen.getByText(k)).toBeTruthy();
    fireEvent.click(screen.getByText('knob_bolder'));
    expect(sendTurn).toHaveBeenCalledWith('p1', expect.stringMatching(/bolder and more expressive/));
  });
});
