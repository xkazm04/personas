import { test, expect } from '@playwright/test';
import { ArtistBridge } from './artist-bridge';

const bridge = new ArtistBridge();

test.describe('Artist plugin — smoke', () => {
  test.beforeAll(async () => {
    const health = await bridge.health();
    expect(health.status).toBe('ok');
  });

  test('tabs switch and render their own page wrapper', async () => {
    await bridge.openArtist('blender');
    expect((await bridge.query('[data-testid="artist-page-blender"]')).length).toBeGreaterThan(0);

    await bridge.setArtistTab('gallery');
    await bridge.waitForSelector('[data-testid="artist-page-gallery"]');
    expect((await bridge.query('[data-testid="artist-page-gallery"]')).length).toBeGreaterThan(0);

    await bridge.setArtistTab('media-studio');
    await bridge.waitForSelector('[data-testid="artist-page-media-studio"]');
    expect((await bridge.query('[data-testid="artist-page-media-studio"]')).length).toBeGreaterThan(0);
  });

  test('Media Studio empty state shows starter templates', async () => {
    await bridge.openArtist('media-studio');
    await bridge.waitForSelector('[data-testid="media-studio-empty-state"]');

    // All three starter templates render.
    for (const id of ['vertical-9-16', 'horizontal-16-9', 'square'] as const) {
      const nodes = await bridge.query(`[data-testid="starter-template-${id}"]`);
      expect(nodes.length).toBe(1);
    }
  });

  test('applying a starter template renames the composition', async () => {
    await bridge.openArtist('media-studio');
    await bridge.waitForSelector('[data-testid="starter-template-vertical-9-16"]');

    await bridge.applyStarterTemplate('vertical-9-16');

    // The toolbar's CompositionIdentity input value should flip to the
    // template name. We don't pin the exact string (it's i18n-translated)
    // but it should contain "9" + ":" + "16" or "Vertical".
    const name = await bridge.getCompositionName();
    expect(name).not.toBeNull();
    expect(name?.toLowerCase()).toMatch(/9.*16|vertical/);
  });
});
