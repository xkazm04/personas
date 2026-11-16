import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useThemeStore } from '../themeStore';
import { storeBus } from '@/lib/storeBus';
import type { CustomThemeConfig } from '@/lib/theme/deriveCustomTheme';

/**
 * Every control on the highlighted Appearance panel must emit appearance:changed
 * (it completes the Getting Started tour step). setTimezone is excluded: its
 * picker is hidden (no reader), so there is no control to complete the step.
 */
const cfg: CustomThemeConfig = { baseMode: 'dark', primaryColor: '#3366cc', accentColor: null, label: 'Mine' };

describe('themeStore setters emit appearance:changed', () => {
  let emit: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    useThemeStore.setState({ themeId: 'dark-midnight', customTheme: null });
    emit = vi.spyOn(storeBus, 'emit');
  });
  afterEach(() => emit.mockRestore());

  const appearanceCalls = () => emit.mock.calls.filter((c) => c[0] === 'appearance:changed');

  it('setCustomTheme', () => {
    useThemeStore.getState().setCustomTheme(cfg);
    expect(appearanceCalls()).toHaveLength(1);
  });

  it('clearCustomTheme', () => {
    useThemeStore.getState().setCustomTheme(cfg);
    emit.mockClear();
    useThemeStore.getState().clearCustomTheme();
    expect(appearanceCalls()).toHaveLength(1);
  });
});
