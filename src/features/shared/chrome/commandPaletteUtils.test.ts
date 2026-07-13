import { describe, it, expect, vi } from 'vitest';
import { settingEntry, entryScore, reachablePaletteSections, type PaletteItem } from './commandPaletteUtils';
import { NAV_SECTIONS } from '@/lib/navigation/registry';
import { TIERS, type Tier } from '@/lib/constants/uiModes';

describe('reachablePaletteSections', () => {
  const allTiersVisible = () => true;
  const starterOnly = (min: Tier) => min === TIERS.STARTER;

  it('surfaces every non-hidden section for a dev + full-tier context', () => {
    const ids = reachablePaletteSections({ isDev: true, isTierVisible: allTiersVisible }).map((e) => e.id);
    // 11/11 reachable: all sidebar sections + the overlay-only Schedules.
    expect(ids).toEqual(NAV_SECTIONS.map((e) => e.id));
    expect(ids).toContain('teams');
    expect(ids).toContain('studio');
    expect(ids).toContain('schedules');
  });

  it('drops devOnly + higher-tier sections for a prod + starter context', () => {
    const ids = reachablePaletteSections({ isDev: false, isTierVisible: starterOnly }).map((e) => e.id);
    expect(ids).not.toContain('studio');   // devOnly
    expect(ids).not.toContain('teams');    // TEAM tier
    expect(ids).not.toContain('events');   // TEAM tier
    expect(ids).not.toContain('plugins');  // TEAM tier
    // Ungated sections still appear.
    expect(ids).toContain('home');
    expect(ids).toContain('personas');
    expect(ids).toContain('settings');
  });

  it('preserves canonical nav order', () => {
    const ids = reachablePaletteSections({ isDev: true, isTierVisible: allTiersVisible }).map((e) => e.id);
    const registryOrder = NAV_SECTIONS.map((e) => e.id);
    expect(ids).toEqual(registryOrder.filter((id) => ids.includes(id)));
  });

  it('marks Schedules as overlay-only so the palette opens its overlay', () => {
    const schedules = reachablePaletteSections({ isDev: true, isTierVisible: allTiersVisible })
      .find((e) => e.id === 'schedules');
    expect(schedules?.reachability).toBe('overlay-only');
  });
});

describe('settingEntry', () => {
  it('builds a togglable entry that flips state and keeps the palette open', () => {
    const onToggle = vi.fn();
    const entry = settingEntry({
      id: 'reduce-motion',
      label: 'Reduce motion',
      icon: null,
      toggle: { isOn: false, onToggle },
    });

    expect(entry.id).toBe('setting:reduce-motion');
    expect(entry.kind).toBe('setting');
    expect(entry.staysOpen).toBe(true);
    expect(entry.toggle?.isOn).toBe(false);

    entry.onSelect();
    expect(onToggle).toHaveBeenCalledWith(true); // flips to the opposite of isOn
  });

  it('builds a navigational entry that closes the palette on select', () => {
    const onNavigate = vi.fn();
    const entry = settingEntry({
      id: 'tab-appearance',
      label: 'Appearance',
      icon: null,
      onNavigate,
    });

    expect(entry.staysOpen).toBeFalsy();
    expect(entry.toggle).toBeUndefined();
    entry.onSelect();
    expect(onNavigate).toHaveBeenCalledOnce();
  });

  it('does not throw when a navigational entry has no handler', () => {
    const entry = settingEntry({ id: 'noop', label: 'No-op', icon: null });
    expect(() => entry.onSelect()).not.toThrow();
  });
});

describe('entryScore', () => {
  const make = (over: Partial<PaletteItem>): PaletteItem => ({
    id: 'x', kind: 'setting', label: 'Theme & colors', icon: null, onSelect: () => {}, ...over,
  });

  it('scores an exact label match highest', () => {
    expect(entryScore('Theme & colors', make({}))).toBe(100);
  });

  it('matches via keywords (weighted) when the label does not match', () => {
    const item = make({ label: 'Appearance', keywords: ['dark', 'accent'] });
    expect(entryScore('dark', item)).toBeGreaterThan(0);
  });

  it('matches via description (weighted) below an equivalent label match', () => {
    const labelMatch = entryScore('appearance', make({ label: 'appearance' }));
    const descMatch = entryScore('appearance', make({ label: 'Theme', description: 'appearance' }));
    expect(descMatch).toBeGreaterThan(0);
    expect(descMatch).toBeLessThan(labelMatch);
  });

  it('returns 0 when nothing matches', () => {
    expect(entryScore('zzzzz', make({ label: 'Theme', keywords: ['dark'] }))).toBe(0);
  });
});
