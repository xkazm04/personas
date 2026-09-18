import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { PreviewRow, ScraperConfig } from '@/api/scraper';
import { countProductiveRows, previewSignature, useScrapeForm, type RuleField } from '../useScrapeForm';

/**
 * Sweep #47 — the wizard could save an ENABLED cron scrape whose rules had never
 * been dry-run: `stepComplete(..., 'preview')` was hard-coded `true` and
 * `canSave` never consulted a preview. An unpreviewed armed scrape is a broken
 * selector harvesting nothing on a schedule, wearing a green pill.
 */

const field = (over: Partial<RuleField> = {}): RuleField => ({
  id: 'f1', name: 'price', type: 'css', selector: '.price', attr: '', all: false,
  pattern: '', group: 0, pointer: '', ...over,
});

const row = (over: Partial<PreviewRow> = {}): PreviewRow => ({
  url: 'https://example.com/p/1',
  record: { price: '12.00' },
  error: null,
  bytes: 4096,
  ...over,
});

const config = (): ScraperConfig =>
  ({
    id: 's1',
    name: 'Price watch',
    description: null,
    urls: ['https://example.com/p/1'],
    rules: { price: { type: 'css', selector: '.price', attr: null, all: false } },
    dataset: 'products',
    keyField: null,
    cron: '0 6 * * *',
    enabled: true,
  }) as unknown as ScraperConfig;

describe('countProductiveRows', () => {
  it('does not count a row that fetched fine but matched nothing', () => {
    expect(countProductiveRows([row({ record: { price: '' } })], ['price'])).toBe(0);
    expect(countProductiveRows([row({ record: { price: [] } })], ['price'])).toBe(0);
    expect(countProductiveRows([row({ record: { price: null } })], ['price'])).toBe(0);
  });

  it('does not count a row that failed to fetch', () => {
    expect(countProductiveRows([row({ error: 'timeout', record: null })], ['price'])).toBe(0);
  });

  it('counts a row with at least one extracted value', () => {
    expect(countProductiveRows([row(), row({ url: 'b', record: { price: '' } })], ['price'])).toBe(1);
  });
});

describe('previewSignature', () => {
  it('changes when a selector is edited', () => {
    const a = previewSignature(['https://x'], [field()]);
    const b = previewSignature(['https://x'], [field({ selector: '.price-new' })]);
    expect(a).not.toBe(b);
  });

  it('changes when a URL is added', () => {
    const a = previewSignature(['https://x'], [field()]);
    const b = previewSignature(['https://x', 'https://y'], [field()]);
    expect(a).not.toBe(b);
  });
});

describe('useScrapeForm preview gate', () => {
  // The config identity must be STABLE across renders: `useScrapeForm`'s reset
  // effect keys on it, so a fresh object per render is an infinite loop.
  const render = (initial: ScraperConfig | null = config()) =>
    renderHook(() => useScrapeForm(initial, true));

  it('refuses to save an enabled scrape that was never previewed', () => {
    const { result } = render();
    expect(result.current.enabled).toBe(true);
    expect(result.current.canSave).toBe(false);
    expect(result.current.saveBlockedReason).toBe('preview');
  });

  it('allows the save once a preview produced a record for these rules', () => {
    const { result } = render();
    act(() => result.current.recordPreview([row()]));
    expect(result.current.previewProven).toBe(true);
    expect(result.current.canSave).toBe(true);
    expect(result.current.saveBlockedReason).toBeNull();
  });

  it('does not accept a preview that extracted nothing as proof', () => {
    const { result } = render();
    act(() => result.current.recordPreview([row({ record: { price: '' } })]));
    expect(result.current.previewProven).toBe(false);
    expect(result.current.canSave).toBe(false);
  });

  it('invalidates the proof when a rule is edited afterwards', () => {
    const { result } = render();
    act(() => result.current.recordPreview([row()]));
    expect(result.current.canSave).toBe(true);
    act(() => result.current.updateField(result.current.fields[0]!.id, { selector: '.price-v2' }));
    expect(result.current.previewStale).toBe(true);
    expect(result.current.previewProven).toBe(false);
    expect(result.current.canSave).toBe(false);
  });

  it('allows saving an unpreviewed scrape as long as it is parked (not enabled)', () => {
    const { result } = render();
    act(() => result.current.setEnabled(false));
    expect(result.current.canSave).toBe(true);
    expect(result.current.saveBlockedReason).toBeNull();
  });

  it('still blocks on missing fields before it blocks on the preview', () => {
    const { result } = render(null);
    expect(result.current.saveBlockedReason).toBe('fields');
  });
});
