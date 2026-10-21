/**
 * The Appearance page painted English in every locale: the brightness and text-size tiles
 * (labels live in themeStore), the colour-row names, the "auto" tag, the picker tooltip and
 * the hover preview's status chips were literals. The catalog is mocked with each leaf replaced
 * by its own key path, so a literal fails the assertion and a catalog lookup passes it.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as unknown as Record<string, unknown>;
  const mark = (node: unknown, path: string): unknown =>
    typeof node === 'string'
      ? path
      : Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, mark(v, path ? `${path}.${k}` : k)]));
  const t = mark(en, '');
  const tx = (s: string, p?: Record<string, unknown>) => `${s}${p ? JSON.stringify(p) : ''}`;
  return { useTranslation: () => ({ t, tx }) };
});

import { useThemeStore, THEMES, DARK_BRIGHTNESS_LEVELS, LIGHT_BRIGHTNESS_LEVELS, TEXT_SCALES } from '@/stores/themeStore';
import enJson from '@/i18n/locales/en.json';
import AppearanceBrightnessSettings from '../AppearanceBrightnessSettings';
import AppearanceTextSizeSettings from '../AppearanceTextSizeSettings';
import { AppearanceThemeHoverPreview } from '../AppearanceThemeHoverPreview';
import CustomThemeCreator from '../CustomThemeCreator';

const A = 'settings.appearance.';
const catalog = (enJson as unknown as { settings: { appearance: Record<string, string> } }).settings.appearance;

describe('Appearance copy speaks through the catalog', () => {
  it('every brightness and text-size key the store names exists in en.json', () => {
    for (const d of [...DARK_BRIGHTNESS_LEVELS, ...LIGHT_BRIGHTNESS_LEVELS, ...TEXT_SCALES]) {
      expect(typeof catalog[d.labelKey]).toBe('string');
      expect(typeof catalog[d.descriptionKey]).toBe('string');
    }
  });

  it('brightness tiles', () => {
    useThemeStore.setState({ brightness: 'low', themeId: 'dark-midnight', customTheme: null });
    render(<AppearanceBrightnessSettings />);
    expect(screen.getByText(`${A}brightness_dark_low`)).toBeTruthy();
    expect(screen.getByText(`${A}brightness_dark_high_desc`)).toBeTruthy();
    expect(screen.queryByText('Default depth')).toBeNull();
  });

  it('text size tiles', () => {
    render(<AppearanceTextSizeSettings />);
    expect(screen.getByText(`${A}text_scale_larger`)).toBeTruthy();
    expect(screen.getByText(`${A}text_scale_xl_desc`)).toBeTruthy();
    expect(screen.queryByText('Compact readability')).toBeNull();
  });

  it('hover preview chips', () => {
    render(<AppearanceThemeHoverPreview theme={THEMES[0]} />);
    for (const k of ['preview_ok', 'preview_info', 'preview_warn', 'preview_err', 'preview_run', 'preview_skip']) {
      expect(screen.getByText(`${A}${k}`)).toBeTruthy();
    }
    expect(screen.queryByText('WARN')).toBeNull();
  });

  it('custom theme editor colour rows and tags', () => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
    render(<CustomThemeCreator />);
    for (const k of ['color_primary', 'color_accent', 'color_background', 'color_foreground', 'color_secondary', 'color_border', 'color_card', 'color_muted_text']) {
      expect(screen.getByText(`${A}${k}`)).toBeTruthy();
    }
    expect(screen.getAllByText(`${A}color_auto`).length).toBeGreaterThan(0);
    expect(screen.getByTitle(`${A}color_pick_title{"label":"${A}color_primary"}`)).toBeTruthy();
    expect(screen.getByPlaceholderText(`${A}custom_theme_name_placeholder`)).toBeTruthy();
    expect(screen.queryByText('Muted Text')).toBeNull();
  });
});
