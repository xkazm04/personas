/**
 * Radio (SomaFM / stream player) IPC wrappers.
 *
 * Relocated here from `src/features/plugins/radio/api/radioApi.ts` by the
 * 2026-05-10 orphan-commands wrap-up. The module was always a proper typed
 * wrapper layer, but living under `src/features/**` it needed a standing
 * `no-restricted-imports` eslint-disable to call `invokeWithTimeout`. Moving it
 * to `src/api/` retires the exemption instead of documenting it.
 */
import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { PlayStatus } from '@/lib/bindings/PlayStatus';
import type { RadioState } from '@/lib/bindings/RadioState';
import type { Station } from '@/lib/bindings/Station';
import type { StreamMetadata } from '@/lib/bindings/StreamMetadata';

export const listStations = () =>
  invokeWithTimeout<Station[]>('radio_list_stations');

export const getRadioState = () =>
  invokeWithTimeout<RadioState>('radio_get_state');

export const getNowPlaying = () =>
  invokeWithTimeout<NowPlaying | null>('radio_get_now_playing');

export const radioPlay = () =>
  invokeWithTimeout<RadioState>('radio_play');

export const radioPause = () =>
  invokeWithTimeout<RadioState>('radio_pause');

export const radioNext = () =>
  invokeWithTimeout<RadioState>('radio_next');

export const radioPrev = () =>
  invokeWithTimeout<RadioState>('radio_prev');

export const radioSetStation = (stationId: string) =>
  invokeWithTimeout<RadioState>('radio_set_station', { stationId });

export const radioSetVolume = (volume: number) =>
  invokeWithTimeout<RadioState>('radio_set_volume', { volume });

export const radioReportStatus = (status: PlayStatus, positionSec: number | null = null) =>
  invokeWithTimeout<RadioState>('radio_report_status', { status, positionSec });

export const radioTrackEnded = () =>
  invokeWithTimeout<RadioState>('radio_track_ended');

export const radioFetchSomafmMetadata = (slug: string) =>
  invokeWithTimeout<StreamMetadata | null>('radio_fetch_somafm_metadata', { slug });
