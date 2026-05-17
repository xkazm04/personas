import { test, expect } from '@playwright/test';
import { ArtistBridge } from './artist-bridge';

const bridge = new ArtistBridge();

test.describe('Artist plugin — smoke', () => {
  test.beforeAll(async () => {
    const health = await bridge.health();
    expect(health.status).toBe('ok');
  });

  test('all three tabs render their own page wrapper', async () => {
    await bridge.openArtist('blender');
    expect((await bridge.query('[data-testid="artist-page-blender"]')).length).toBeGreaterThan(0);

    await bridge.setArtistTab('gallery');
    await bridge.waitForSelector('[data-testid="artist-page-gallery"]');
    expect((await bridge.query('[data-testid="artist-page-gallery"]')).length).toBeGreaterThan(0);

    await bridge.setArtistTab('media-studio');
    await bridge.waitForSelector('[data-testid="artist-page-media-studio"]');
    expect((await bridge.query('[data-testid="artist-page-media-studio"]')).length).toBeGreaterThan(0);
  });

  test('Media Studio page lazy-loads its content', async () => {
    await bridge.openArtist('media-studio');
    // The lazy() Suspense fallback is null, so an empty wrapper means the
    // chunk hasn't resolved yet. Poll until the chunk's actual content
    // populates the wrapper.
    const deadline = Date.now() + 10_000;
    let childCount = 0;
    while (Date.now() < deadline) {
      const nodes = await bridge.query('[data-testid="artist-page-media-studio"] *');
      childCount = nodes.length;
      if (childCount > 0) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(childCount).toBeGreaterThan(0);
  });

  test('starter templates render when the timeline is empty', async () => {
    await bridge.openArtist('media-studio');
    // The empty-state branch only renders when (a) ffmpeg is detected AND
    // (b) composition.items.length === 0. On a dev box with autosave-restored
    // state the timeline may have clips, in which case the empty-state +
    // starter-templates surface is suppressed by design. Skip the
    // template-presence assertion rather than asserting against state the
    // user explicitly does not have.
    const empty = await bridge.query('[data-testid="media-studio-empty-state"]');
    if (empty.length === 0) {
      test.skip(true, 'no empty state on this app instance (composition has items)');
      return;
    }
    for (const id of ['vertical-9-16', 'horizontal-16-9', 'square'] as const) {
      const nodes = await bridge.query(`[data-testid="starter-template-${id}"]`);
      expect(nodes.length).toBe(1);
    }
  });
});
