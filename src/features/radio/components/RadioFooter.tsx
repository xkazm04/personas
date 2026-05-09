import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play, Radio, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import type { PlayStatus } from '@/lib/bindings/PlayStatus';
import { useRadioState } from '../hooks/useRadioState';
import {
  radioNext,
  radioPause,
  radioPlay,
  radioReportStatus,
  radioSetStation,
} from '../api/radioApi';
import StationPicker from './StationPicker';

/**
 * Time we give the `<audio>` element to reach the `playing` state after a
 * play/load. If it stalls past this without surfacing a real `error` event,
 * we treat the station as unavailable, surface a toast, and report
 * `stopped` so the UI doesn't sit forever in a fake "playing" indicator.
 */
const PLAYBACK_WATCHDOG_MS = 8000;

export default function RadioFooter() {
  const { t, tx } = useTranslation();
  const { state, nowPlaying, stations, loaded } = useRadioState();
  const [pickerOpen, setPickerOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const lastReportedRef = useRef<PlayStatus>('stopped');
  const currentSrcRef = useRef<string | null>(null);

  const reportStatus = useCallback((status: PlayStatus) => {
    if (lastReportedRef.current === status) return;
    lastReportedRef.current = status;
    radioReportStatus(status).catch(silentCatch('radio:report-status'));
  }, []);

  const cancelWatchdog = useCallback(() => {
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const armWatchdog = useCallback(
    (stationName: string) => {
      cancelWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (lastReportedRef.current === 'playing') return;
        audioRef.current?.pause();
        reportStatus('stopped');
        useToastStore
          .getState()
          .addToast(tx(t.radio.unavailable_toast, { station: stationName }), 'error');
      }, PLAYBACK_WATCHDOG_MS);
    },
    [cancelWatchdog, reportStatus, t, tx],
  );

  // Sync the <audio> element with backend state. The backend is the source
  // of truth for "what should be playing"; this effect translates that into
  // imperative HTMLMediaElement calls.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !nowPlaying) return;

    const desiredUrl = nowPlaying.station.streamUrl;
    const desiredPlaying = state?.status === 'playing' || state?.status === 'buffering';
    const stationName = nowPlaying.station.name;

    if (currentSrcRef.current !== desiredUrl) {
      currentSrcRef.current = desiredUrl;
      audio.src = desiredUrl;
      audio.load();
      cancelWatchdog();
      lastReportedRef.current = 'stopped';
      if (desiredPlaying) {
        audio.play().catch(silentCatch('radio:audio-play'));
        armWatchdog(stationName);
      }
      return;
    }

    if (desiredPlaying && audio.paused) {
      audio.play().catch(silentCatch('radio:audio-play'));
      armWatchdog(stationName);
    } else if (!desiredPlaying && !audio.paused) {
      audio.pause();
      cancelWatchdog();
    }
  }, [nowPlaying, state?.status, armWatchdog, cancelWatchdog]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state) return;
    if (Math.abs(audio.volume - state.volume) > 0.01) {
      audio.volume = state.volume;
    }
  }, [state?.volume, state]);

  useEffect(() => () => cancelWatchdog(), [cancelWatchdog]);

  if (!loaded || stations.length === 0) return null;

  const status = state?.status ?? 'stopped';
  const isPlaying = status === 'playing' || status === 'buffering';
  const accent = nowPlaying?.station.accentColor ?? '#666';

  const togglePlay = () => {
    (isPlaying ? radioPause() : radioPlay()).catch(silentCatch('radio:footer'));
  };
  const skip = () => {
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
  const onAudioWaiting = () => {
    reportStatus('buffering');
  };
  const onAudioError = () => {
    cancelWatchdog();
    reportStatus('stopped');
    if (nowPlaying) {
      useToastStore
        .getState()
        .addToast(
          tx(t.radio.unavailable_toast, { station: nowPlaying.station.name }),
          'error',
        );
    }
  };

  return (
    <div
      role="region"
      aria-label={t.radio.footer_label}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-card border border-primary/10 bg-card-bg/95 backdrop-blur shadow-elevation-2 pl-3 pr-2 py-2 select-none"
      style={{ minWidth: '280px', maxWidth: '380px' }}
    >
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
      <span
        aria-hidden
        className="w-2 h-2 rounded-full shrink-0"
        style={{
          background: accent,
          boxShadow: isPlaying ? `0 0 8px ${accent}` : 'none',
          transition: 'box-shadow 200ms',
        }}
      />
      <div className="min-w-0 flex-1">
        <p className="typo-caption font-medium text-foreground/90 truncate">
          {nowPlaying ? nowPlaying.station.name : t.radio.idle_title}
        </p>
        <p className="typo-caption text-foreground/55 truncate">
          {nowPlaying ? nowPlaying.station.description : t.radio.idle_subtitle}
        </p>
      </div>
      <button
        type="button"
        onClick={togglePlay}
        className="p-1.5 rounded-interactive hover:bg-secondary/30 transition-colors text-foreground/80"
        aria-label={isPlaying ? t.radio.pause : t.radio.play}
        title={isPlaying ? t.radio.pause : t.radio.play}
      >
        {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>
      <button
        type="button"
        onClick={skip}
        className="p-1.5 rounded-interactive hover:bg-secondary/30 transition-colors text-foreground/80"
        aria-label={t.radio.skip}
        title={t.radio.skip}
      >
        <SkipForward className="w-4 h-4" />
      </button>
      <div className="relative">
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="p-1.5 rounded-interactive hover:bg-secondary/30 transition-colors text-foreground/80"
          aria-label={t.radio.switch_station}
          title={t.radio.switch_station}
          aria-expanded={pickerOpen}
        >
          <Radio className="w-4 h-4" />
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
