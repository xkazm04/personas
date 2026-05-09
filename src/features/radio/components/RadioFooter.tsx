import { useState } from 'react';
import { Pause, Play, Radio, SkipForward } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useRadioState } from '../hooks/useRadioState';
import { radioNext, radioPause, radioPlay, radioSetStation } from '../api/radioApi';
import StationPicker from './StationPicker';

/**
 * Radio controller pinned to the bottom-right of the main window. Renders
 * nothing until the first state snapshot arrives so first-paint isn't
 * blocked. Click play to start, click the station icon to switch stations
 * (per-station playback cursors persist).
 */
export default function RadioFooter() {
  const { t } = useTranslation();
  const { state, nowPlaying, stations, loaded } = useRadioState();
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!loaded || stations.length === 0) return null;

  const status = state?.status ?? 'stopped';
  const isPlaying = status === 'playing' || status === 'buffering';
  const accent = nowPlaying?.station.accentColor ?? '#666';

  const togglePlay = () => {
    (isPlaying ? radioPause() : radioPlay()).catch(silentCatch('radio:footer'));
  };
  const skip = () => { radioNext().catch(silentCatch('radio:footer')); };
  const pickStation = (id: string) => {
    setPickerOpen(false);
    radioSetStation(id).catch(silentCatch('radio:footer'));
  };

  return (
    <div
      role="region"
      aria-label={t.radio.footer_label}
      className="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-card border border-primary/10 bg-card-bg/95 backdrop-blur shadow-elevation-2 pl-3 pr-2 py-2 select-none"
      style={{ minWidth: '280px', maxWidth: '380px' }}
    >
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
          {nowPlaying?.track.title ?? t.radio.idle_title}
        </p>
        <p className="typo-caption text-foreground/55 truncate">
          {nowPlaying ? nowPlaying.station.name : t.radio.idle_subtitle}
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
