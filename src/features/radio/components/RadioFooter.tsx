import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, Radio, SkipBack, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { PlayStatus } from '@/lib/bindings/PlayStatus';
import { useRadioState } from '../hooks/useRadioState';
import { useYouTubePlayer } from '../hooks/useYouTubePlayer';
import {
  radioNext,
  radioPause,
  radioPlay,
  radioPrev,
  radioReportStatus,
  radioSetStation,
  radioTrackEnded,
} from '../api/radioApi';
import StationPicker from './StationPicker';

/**
 * Time we give either engine to reach `playing` state after a play/load.
 * Past this, treat the source as unavailable: surface a toast and (for
 * YouTube) advance the cursor so a single bad video doesn't deadlock
 * the station.
 */
const PLAYBACK_WATCHDOG_MS = 8000;

/** YT IFrame Player state codes. */
const YT_STATE = {
  UNSTARTED: -1,
  ENDED: 0,
  PLAYING: 1,
  PAUSED: 2,
  BUFFERING: 3,
  CUED: 5,
} as const;

/** YT errors we treat as "skip this track and keep the radio rolling". */
function isFatalYouTubeError(code: number): boolean {
  // 100 video not found, 101/150 embedding disabled by uploader,
  // 5 HTML5 player error (often hostile responses), 2 invalid video id.
  return code === 2 || code === 5 || code === 100 || code === 101 || code === 150;
}

/**
 * Radio controller. Renders inside `DesktopFooter` as a centered child.
 * Owns two playback engines:
 *
 * - **YouTube IFrame Player** for `youtubeTracks` stations — mounted in
 *   a hidden 200×200 div positioned off-screen so the audio plays
 *   without the video being visible.
 * - **HTML5 `<audio>`** for `stream` stations — mounted in the footer
 *   itself (no visible UI, just an audio element).
 *
 * Backend `RadioState` is the source of truth; effects translate that
 * into imperative engine calls. Engine events are reported back via
 * `radio_report_status` to keep persisted state in sync.
 */
export default function RadioFooter() {
  const { t, tx } = useTranslation();
  const { state, nowPlaying, stations, loaded } = useRadioState();
  const [pickerOpen, setPickerOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytHostRef = useRef<HTMLDivElement | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const lastReportedRef = useRef<PlayStatus>('stopped');
  const currentStreamUrlRef = useRef<string | null>(null);
  const currentVideoIdRef = useRef<string | null>(null);

  const stationKind = nowPlaying?.station.source.kind ?? null;
  const isStream = stationKind === 'stream';
  const isYoutube = stationKind === 'youtubeTracks';

  const reportStatus = useCallback((status: PlayStatus, positionSec: number | null = null) => {
    if (lastReportedRef.current === status && positionSec === null) return;
    lastReportedRef.current = status;
    radioReportStatus(status, positionSec).catch(silentCatch('radio:report-status'));
  }, []);

  const cancelWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const showUnavailableToast = useCallback(
    (label: string) => {
      useToastStore
        .getState()
        .addToast(tx(t.radio.unavailable_toast, { station: label }), 'error');
    },
    [t, tx],
  );

  const armWatchdog = useCallback(
    (label: string, onTimeout: () => void) => {
      cancelWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (lastReportedRef.current === 'playing') return;
        showUnavailableToast(label);
        onTimeout();
      }, PLAYBACK_WATCHDOG_MS);
    },
    [cancelWatchdog, showUnavailableToast],
  );

  const onYtStateChange = useCallback(
    (code: number) => {
      if (code === YT_STATE.PLAYING) {
        cancelWatchdog();
        reportStatus('playing');
      } else if (code === YT_STATE.PAUSED) {
        if (lastReportedRef.current !== 'stopped') reportStatus('paused');
      } else if (code === YT_STATE.BUFFERING) {
        reportStatus('buffering');
      } else if (code === YT_STATE.ENDED) {
        // Natural end-of-track — let backend advance the cursor.
        radioTrackEnded().catch(silentCatch('radio:track-ended'));
      }
      // CUED / UNSTARTED → no-op
    },
    [cancelWatchdog, reportStatus],
  );

  const onYtError = useCallback(
    (code: number) => {
      cancelWatchdog();
      if (isFatalYouTubeError(code)) {
        // Skip past the unplayable track. Toast only if the next track
        // also fails — the watchdog covers that.
        radioTrackEnded().catch(silentCatch('radio:track-ended'));
      } else {
        reportStatus('stopped');
        if (nowPlaying) showUnavailableToast(nowPlaying.station.name);
      }
    },
    [cancelWatchdog, reportStatus, showUnavailableToast, nowPlaying],
  );

  const ytHandle = useYouTubePlayer(ytHostRef, {
    onStateChange: onYtStateChange,
    onError: onYtError,
  });

  // ---------------------------------------------------------------------
  // Engine sync — translate backend RadioState into imperative engine calls.
  // ---------------------------------------------------------------------

  // Stream engine.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const desiredPlaying = state?.status === 'playing' || state?.status === 'buffering';

    if (!isStream) {
      // Switched away from a stream station — pause the audio element.
      if (!audio.paused) audio.pause();
      currentStreamUrlRef.current = null;
      return;
    }

    const desiredUrl =
      nowPlaying?.station.source.kind === 'stream' ? nowPlaying.station.source.streamUrl : null;
    if (!desiredUrl) return;

    if (currentStreamUrlRef.current !== desiredUrl) {
      currentStreamUrlRef.current = desiredUrl;
      audio.src = desiredUrl;
      audio.load();
      cancelWatchdog();
      lastReportedRef.current = 'stopped';
      if (desiredPlaying) {
        audio.play().catch(silentCatch('radio:audio-play'));
        armWatchdog(nowPlaying!.station.name, () => {
          audio.pause();
          reportStatus('stopped');
        });
      }
      return;
    }

    if (desiredPlaying && audio.paused) {
      audio.play().catch(silentCatch('radio:audio-play'));
      armWatchdog(nowPlaying!.station.name, () => {
        audio.pause();
        reportStatus('stopped');
      });
    } else if (!desiredPlaying && !audio.paused) {
      audio.pause();
      cancelWatchdog();
    }
  }, [isStream, nowPlaying, state?.status, armWatchdog, cancelWatchdog, reportStatus]);

  // YouTube engine.
  useEffect(() => {
    const player = ytHandle.current;
    if (!player || !isYoutube || !nowPlaying) {
      // Switched away from YT — pause the player so audio stops.
      // The handle's `pause()` swallows errors internally for the
      // not-yet-ready case.
      if (!isYoutube && ytHandle.current) {
        ytHandle.current.pause();
        currentVideoIdRef.current = null;
      }
      return;
    }
    const videoId = nowPlaying.track?.videoId ?? null;
    const desiredPlaying = state?.status === 'playing' || state?.status === 'buffering';
    if (!videoId) return;

    if (currentVideoIdRef.current !== videoId) {
      currentVideoIdRef.current = videoId;
      const startSeconds =
        (state?.currentStationId &&
          state.stationCursors?.[state.currentStationId]?.positionSec) || 0;
      cancelWatchdog();
      lastReportedRef.current = 'stopped';
      player.loadVideo(videoId, { startSeconds, autoplay: desiredPlaying });
      if (desiredPlaying) {
        armWatchdog(nowPlaying.station.name, () => {
          // Most "embed disabled" tracks would have fired onError already;
          // this watchdog handles the silent-stall variant by skipping.
          radioTrackEnded().catch(silentCatch('radio:track-ended'));
        });
      }
      return;
    }

    if (desiredPlaying) {
      player.play();
    } else {
      player.pause();
      cancelWatchdog();
    }
  }, [isYoutube, nowPlaying, state?.status, state?.stationCursors, state?.currentStationId, ytHandle, armWatchdog, cancelWatchdog]);

  // Volume sync (both engines).
  useEffect(() => {
    if (!state) return;
    if (audioRef.current && Math.abs(audioRef.current.volume - state.volume) > 0.01) {
      audioRef.current.volume = state.volume;
    }
    ytHandle.current?.setVolume(state.volume);
  }, [state?.volume, state, ytHandle]);

  useEffect(() => () => cancelWatchdog(), [cancelWatchdog]);

  // ---------------------------------------------------------------------
  // Render.
  // ---------------------------------------------------------------------

  const status = state?.status ?? 'stopped';
  const isPlayingNow = status === 'playing' || status === 'buffering';
  const accent = nowPlaying?.station.accentColor ?? '#666';

  const togglePlay = () => {
    (isPlayingNow ? radioPause() : radioPlay()).catch(silentCatch('radio:footer'));
  };
  const onPrev = () => {
    if (!isYoutube) return;
    radioPrev().catch(silentCatch('radio:footer'));
  };
  const onNext = () => {
    if (!isYoutube) return;
    radioNext().catch(silentCatch('radio:footer'));
  };
  const pickStation = (id: string) => {
    setPickerOpen(false);
    radioSetStation(id).catch(silentCatch('radio:footer'));
  };

  const onAudioPlaying = () => {
    cancelWatchdog();
    reportStatus('playing');
  };
  const onAudioPause = () => {
    if (lastReportedRef.current === 'stopped') return;
    reportStatus('paused');
  };
  const onAudioWaiting = () => reportStatus('buffering');
  const onAudioError = () => {
    cancelWatchdog();
    reportStatus('stopped');
    if (nowPlaying) showUnavailableToast(nowPlaying.station.name);
  };

  const titleLine = useMemo(() => {
    if (!nowPlaying) return t.radio.idle_title;
    if (nowPlaying.track) return `${nowPlaying.track.artist} — ${nowPlaying.track.title}`;
    return nowPlaying.station.name;
  }, [nowPlaying, t]);

  // Off-screen host for the YouTube player. 200×200 stays above YT's
  // minimum playable size; positioning takes it off the visible canvas.
  const ytHostStyle: React.CSSProperties = {
    position: 'fixed',
    left: '-10000px',
    top: '-10000px',
    width: '200px',
    height: '200px',
    pointerEvents: 'none',
  };

  if (!loaded || stations.length === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label={t.radio.footer_label}
      className="flex items-center gap-1 select-none"
    >
      {/* Hidden engines */}
      <audio
        ref={audioRef}
        preload="none"
        onPlaying={onAudioPlaying}
        onPause={onAudioPause}
        onWaiting={onAudioWaiting}
        onStalled={onAudioWaiting}
        onError={onAudioError}
        aria-hidden
      />
      <div ref={ytHostRef} style={ytHostStyle} aria-hidden tabIndex={-1} />

      {/* Visible controls */}
      <button
        type="button"
        onClick={onPrev}
        disabled={!isYoutube}
        className="w-6 h-6 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        aria-label={t.radio.prev_track}
        title={isYoutube ? t.radio.prev_track : t.radio.prev_track_disabled}
      >
        <SkipBack className="w-3.5 h-3.5" />
      </button>
      <button
        type="button"
        onClick={togglePlay}
        className="w-7 h-7 rounded-interactive flex items-center justify-center text-foreground hover:bg-secondary/50 transition-colors"
        aria-label={isPlayingNow ? t.radio.pause : t.radio.play}
        title={isPlayingNow ? t.radio.pause : t.radio.play}
      >
        {isPlayingNow ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!isYoutube}
        className="w-6 h-6 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        aria-label={t.radio.next_track}
        title={isYoutube ? t.radio.next_track : t.radio.next_track_disabled}
      >
        <SkipForward className="w-3.5 h-3.5" />
      </button>

      <div className="flex items-center gap-1.5 max-w-[260px] min-w-0 ml-1">
        <span
          aria-hidden
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{
            background: accent,
            boxShadow: isPlayingNow ? `0 0 6px ${accent}` : 'none',
            transition: 'box-shadow 200ms',
          }}
        />
        <span
          className="typo-caption text-foreground/85 truncate"
          title={titleLine}
        >
          {titleLine}
        </span>
      </div>

      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="w-6 h-6 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 transition-colors ml-1"
          aria-label={t.radio.switch_station}
          title={t.radio.switch_station}
          aria-expanded={pickerOpen}
        >
          <Radio className="w-3.5 h-3.5" />
        </button>
        {pickerOpen && (
          <StationPicker
            stations={stations}
            currentStationId={state?.currentStationId ?? null}
            onPick={pickStation}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
