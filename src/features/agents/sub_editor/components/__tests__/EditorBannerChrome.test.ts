/**
 * ONE BANNER PRIMITIVE IN THE EDITOR.
 *
 * EditorBody drew its two red save-failure banners with inline chrome while
 * EditorBanners shipped a BannerPrimitive red scheme nothing used (plus two
 * more unused schemes), so the editor's banners differed in padding and
 * dismissability. Pinned by source: no inline red banner chrome in EditorBody,
 * and EditorBanners carries only schemes something renders.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');

describe('editor banner chrome', () => {
  it('EditorBody has no inline red banner classes', () => {
    const body = read('EditorBody.tsx');
    expect(body.split('bg-red-500/10').length - 1).toBe(0);
  });

  it('EditorBanners defines no unused colour schemes', () => {
    const banners = read('EditorBanners.tsx');
    expect(banners.includes('violet')).toBe(false);
    expect(banners.includes('sky-')).toBe(false);
  });
});
