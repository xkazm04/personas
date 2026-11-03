import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { en } from '@/i18n/en';
import CustomThemeCreator from '../CustomThemeCreator';

/**
 * The custom theme editor's save / switch / reopen / reset lifecycle. Each case reproduced a
 * defect at HEAD before its fix (scan-sweep 2026-10-31):
 * - Reset cleared the custom theme AND switched an active non-custom theme to Midnight, because
 *   clearCustomTheme always applies the dark-midnight fallback.
 * - The action button read "Applied" for a saved theme that was not the active theme.
 */
const SAVED = { baseMode: 'dark' as const, primaryColor: '#8b5cf6', accentColor: null, label: 'Mine' };

describe('custom theme editor lifecycle', () => {
  const a = en.settings.appearance;
  const clickResetAndConfirm = () => {
    fireEvent.click(screen.getByRole('button', { name: a.reset }));
    fireEvent.click(screen.getByRole('button', { name: a.reset_confirm_action }));
  };
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  beforeEach(() => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
  });

  it('Reset keeps an active non-custom theme', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    act(() => { useThemeStore.getState().setTheme('light-ice'); });
    render(<CustomThemeCreator />);
    clickResetAndConfirm();
    expect(useThemeStore.getState().customTheme).toBeNull();
    expect(useThemeStore.getState().themeId).toBe('light-ice');
  });

  it('Reset of the ACTIVE custom theme falls back to a built-in theme', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    render(<CustomThemeCreator />);
    clickResetAndConfirm();
    expect(useThemeStore.getState().customTheme).toBeNull();
    expect(useThemeStore.getState().themeId).not.toBe('custom');
  });
  it('a saved custom theme that is not active offers Save & Apply, not Applied', () => {
    const { unmount } = render(<CustomThemeCreator />);
    fireEvent.click(screen.getByRole('button', { name: a.save_apply }));
    expect(screen.queryAllByRole('button', { name: a.applied })).toHaveLength(1);
    unmount();
    act(() => { useThemeStore.getState().setTheme('dark-cyan'); });
    render(<CustomThemeCreator />);
    expect(screen.queryAllByRole('button', { name: a.applied })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: a.save_apply })).toHaveLength(1);
  });
  it('Save persists the draft name and a remount shows it with the button reading Applied', () => {
    const { unmount } = render(<CustomThemeCreator />);
    fireEvent.change(screen.getByLabelText(a.theme_name), { target: { value: 'Dusk' } });
    fireEvent.click(screen.getByRole('button', { name: a.save_apply }));
    expect(useThemeStore.getState().customTheme?.label).toBe('Dusk');
    unmount();
    render(<CustomThemeCreator />);
    expect((screen.getByLabelText(a.theme_name) as HTMLInputElement).value).toBe('Dusk');
    expect(screen.queryAllByRole('button', { name: a.applied })).toHaveLength(1);
  });

  it('Reset returns the editor to its defaults and hides the Reset button', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    render(<CustomThemeCreator />);
    expect((screen.getByLabelText(a.theme_name) as HTMLInputElement).value).toBe('Mine');
    clickResetAndConfirm();
    expect((screen.getByLabelText(a.theme_name) as HTMLInputElement).value).toBe('Custom');
    expect(screen.queryAllByRole('button', { name: a.reset })).toHaveLength(0);
  });
  it('a theme saved with the gradient section open but no end colour reopens as saved', () => {
    const { unmount } = render(<CustomThemeCreator />);
    fireEvent.click(screen.getByRole('button', { name: a.background_gradient }));
    fireEvent.click(screen.getByRole('button', { name: a.save_apply }));
    expect(useThemeStore.getState().customTheme).not.toBeNull();
    unmount();
    render(<CustomThemeCreator />);
    expect(screen.queryAllByRole('button', { name: a.applied })).toHaveLength(1);
    expect(screen.queryAllByRole('button', { name: a.save_apply })).toHaveLength(0);
  });
  it('Reset asks first: the saved theme survives until confirmed, and Cancel keeps it', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    render(<CustomThemeCreator />);
    fireEvent.click(screen.getByRole('button', { name: a.reset }));
    expect(screen.getByText(a.reset_confirm_title)).toBeTruthy();
    expect(useThemeStore.getState().customTheme).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }));
    expect(screen.queryByText(a.reset_confirm_title)).toBeNull();
    expect(useThemeStore.getState().customTheme).not.toBeNull();
    clickResetAndConfirm();
    expect(useThemeStore.getState().customTheme).toBeNull();
  });
  it('warns, without blocking Save, when body text falls below AA contrast', () => {
    render(<CustomThemeCreator />);
    expect(screen.queryByText(a.contrast_low_warning)).toBeNull();
    // Foreground set to (almost) the dark default background: unreadable body text.
    fireEvent.click(screen.getByTitle(`Pick ${a.color_foreground}`));
    const region = screen.getByRole('region', { name: `${a.color_foreground} color picker` });
    fireEvent.change(within(region).getByRole('textbox'), { target: { value: '#0a0e14' } });
    expect(screen.queryByText(a.contrast_low_warning)).not.toBeNull();
    const save = screen.getByRole('button', { name: a.save_apply }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(useThemeStore.getState().customTheme?.foregroundColor).toBe('#0a0e14');
  });
});
