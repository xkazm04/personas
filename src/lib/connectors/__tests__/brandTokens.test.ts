import { describe, it, expect } from 'vitest';
import {
  BRAND_TOKENS,
  getBrandTokens,
  hasBrandTokens,
  type BrandTokens,
} from '../brandTokens';

const TOKEN_KEYS: (keyof BrandTokens)[] = [
  'hex',
  'icon',
  'accent',
  'badgeBg',
  'badgeBorder',
  'underline',
];

describe('BRAND_TOKENS registry', () => {
  it('every entry is a complete, non-empty token set', () => {
    for (const [id, tokens] of Object.entries(BRAND_TOKENS)) {
      for (const key of TOKEN_KEYS) {
        expect(tokens[key], `${id}.${key}`).toBeTruthy();
        expect(typeof tokens[key], `${id}.${key} type`).toBe('string');
      }
      expect(tokens.hex, `${id}.hex format`).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it('class fields use the expected Tailwind prefixes', () => {
    for (const [id, tokens] of Object.entries(BRAND_TOKENS)) {
      expect(tokens.icon, `${id}.icon`).toMatch(/^text-/);
      expect(tokens.accent, `${id}.accent`).toMatch(/^text-/);
      expect(tokens.badgeBg, `${id}.badgeBg`).toMatch(/^bg-/);
      expect(tokens.badgeBorder, `${id}.badgeBorder`).toMatch(/^border-/);
      expect(tokens.underline, `${id}.underline`).toMatch(/^bg-/);
    }
  });
});

describe('getBrandTokens', () => {
  it('resolves a known connector id directly', () => {
    expect(getBrandTokens('gitlab')).toBe(BRAND_TOKENS.gitlab);
  });

  it('fixes the GitLab icon-vs-underline mismatch (both orange)', () => {
    const gitlab = getBrandTokens('gitlab');
    expect(gitlab.icon).toContain('orange');
    expect(gitlab.underline).toContain('orange');
  });

  it('resolves aliases to their canonical entry', () => {
    expect(getBrandTokens('obsidian')).toBe(BRAND_TOKENS['obsidian-brain']);
    expect(getBrandTokens('google_drive')).toBe(BRAND_TOKENS.drive);
  });

  it('falls back to a complete neutral token set for unknown ids', () => {
    const unknown = getBrandTokens('totally-not-a-connector');
    for (const key of TOKEN_KEYS) {
      expect(unknown[key]).toBeTruthy();
    }
    // The fallback is theme-neutral (primary), not a borrowed brand hue.
    expect(unknown.icon).toContain('primary');
  });

  it('falls back for null / undefined / empty ids', () => {
    expect(getBrandTokens(null).icon).toContain('primary');
    expect(getBrandTokens(undefined).icon).toContain('primary');
    expect(getBrandTokens('').icon).toContain('primary');
  });

  it('covers every plugin id the Browse grid iterates', () => {
    for (const id of ['dev-tools', 'obsidian-brain', 'drive', 'twin', 'companion', 'langfuse']) {
      expect(hasBrandTokens(id), id).toBe(true);
    }
  });
});

describe('hasBrandTokens', () => {
  it('is true for dedicated entries and aliases, false otherwise', () => {
    expect(hasBrandTokens('gitlab')).toBe(true);
    expect(hasBrandTokens('obsidian')).toBe(true);
    expect(hasBrandTokens('nope')).toBe(false);
    expect(hasBrandTokens(null)).toBe(false);
  });
});
