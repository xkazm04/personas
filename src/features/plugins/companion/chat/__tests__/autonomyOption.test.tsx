/**
 * Athena's quick behaviour setup lives behind ONE header key: autonomous mode
 * (Power), cadence and boldness open inside a small popup instead of filling
 * the header with toggles and accordion strips.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import en from '@/i18n/locales/en.json';
import { useSystemStore } from '@/stores/systemStore';

vi.mock('@/api/companion/bridges', () => ({
  companionWakeStats: vi.fn(async () => ({ windowMinutes: 30, surfaces: [] })),
}));
vi.mock('@/api/system/settings', () => ({ setAppSetting: vi.fn(async () => {}) }));
vi.mock('@/api/companion', () => ({
  companionGetFleetBoldness: vi.fn(async () => 'balanced'),
  companionSetFleetBoldness: vi.fn(async () => {}),
}));
vi.mock('../athenaChatActions', () => ({
  setAutonomousMode: vi.fn((next: boolean) => useSystemStore.setState({ companionAutonomousMode: next })),
}));

import { AthenaAutonomyOption } from '../AthenaAutonomyOption';
import { setAutonomousMode } from '../athenaChatActions';

const LOOK = { button: 'key', active: 'key-on', icon: 'w-4 h-4' };
const c = en.plugins.companion;

beforeEach(() => {
  vi.mocked(setAutonomousMode).mockClear();
  useSystemStore.setState({ companionAutonomousMode: true });
});

describe('AthenaAutonomyOption', () => {
  it('is one key whose look carries the autonomy state', () => {
    const { rerender } = render(<AthenaAutonomyOption look={LOOK} />);
    const key = screen.getByTestId('companion-autonomy-options');
    expect(key.className).toContain('key-on');
    useSystemStore.setState({ companionAutonomousMode: false });
    rerender(<AthenaAutonomyOption look={LOOK} />);
    expect(screen.getByTestId('companion-autonomy-options').className).not.toContain('key-on');
    // Nothing else is painted until it is opened.
    expect(screen.queryByTestId('companion-toggle-autonomous')).toBeNull();
  });

  it('opens a popup with Power, Cadence and Boldness; Power flips autonomous mode', () => {
    render(<AthenaAutonomyOption look={LOOK} />);
    fireEvent.click(screen.getByTestId('companion-autonomy-options'));
    expect(screen.getByTestId('companion-autonomy-popup')).toHaveAttribute('role', 'dialog');
    expect(screen.getByTestId('companion-autonomy-cadence')).toBeInTheDocument();
    expect(screen.getByTestId('companion-autonomy-boldness')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('companion-toggle-autonomous'));
    expect(setAutonomousMode).toHaveBeenCalledWith(false);
  });

  it('reveals one control at a time inside the popup', () => {
    render(<AthenaAutonomyOption look={LOOK} />);
    fireEvent.click(screen.getByTestId('companion-autonomy-options'));
    fireEvent.click(screen.getByTestId('companion-autonomy-cadence'));
    expect(screen.getByTestId('companion-wake-cadence')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('companion-autonomy-boldness'));
    expect(screen.getByTestId('companion-fleet-boldness')).toBeInTheDocument();
    expect(screen.getByTestId('companion-autonomy-cadence')).toHaveAttribute('aria-expanded', 'false');
  });

  it('with autonomy off, cadence and boldness are dormant and say why', () => {
    useSystemStore.setState({ companionAutonomousMode: false });
    render(<AthenaAutonomyOption look={LOOK} />);
    fireEvent.click(screen.getByTestId('companion-autonomy-options'));
    expect(screen.getByTestId('companion-autonomy-needs-power')).toHaveTextContent(c.autonomy_needs_power);
    const cadence = screen.getByTestId('companion-autonomy-cadence');
    expect(cadence).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(cadence);
    expect(screen.queryByTestId('companion-wake-cadence')).toBeNull();
  });

  it('Escape and a press outside close it', () => {
    render(<AthenaAutonomyOption look={LOOK} />);
    fireEvent.click(screen.getByTestId('companion-autonomy-options'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('companion-autonomy-popup')).toBeNull();
    fireEvent.click(screen.getByTestId('companion-autonomy-options'));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('companion-autonomy-popup')).toBeNull();
  });
});
