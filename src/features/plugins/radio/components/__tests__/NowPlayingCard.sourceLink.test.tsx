/**
 * NowPlayingCard: the station source link opens through the host's external
 * URL door (openExternalUrl), like the StationPicker menu, not a raw
 * target=_blank anchor whose webview behaviour is not the system browser.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { Station } from '@/lib/bindings/Station';

const open = vi.hoisted(() => ({ openExternalUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/api/system/system', () => open);

import NowPlayingCard from '../NowPlayingCard';

const STATION: Station = {
  id: 'groovesalad',
  slug: 'groovesalad',
  name: 'Groove Salad',
  description: 'Ambient beats',
  accentColor: '#7c3aed',
  sourceUrl: 'https://somafm.com/groovesalad/',
  sourceLabel: 'SomaFM',
  source: { kind: 'stream', streamUrl: 'https://example.invalid/groovesalad.mp3' },
};

describe('NowPlayingCard source link', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['radio']);
  });

  it('opens the station source through openExternalUrl', () => {
    const nowPlaying: NowPlaying = { station: STATION, track: null, trackIndexInStation: null, status: 'playing' };
    render(
      <NowPlayingCard
        nowPlaying={nowPlaying}
        status="playing"
        isYoutube={false}
        progress={null}
        currentTrackIndex={null}
        streamMetadata={null}
        onTogglePlay={() => undefined}
        onPrev={() => undefined}
        onNext={() => undefined}
        onClose={() => undefined}
        anchorRef={{ current: null }}
      />,
    );
    fireEvent.click(screen.getByText('SomaFM'));
    expect(open.openExternalUrl).toHaveBeenCalledWith('https://somafm.com/groovesalad/');
  });
});
