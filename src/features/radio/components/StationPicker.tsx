import { useEffect, useMemo, useRef } from 'react';
import { Check, Music, Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import type { Station } from '@/lib/bindings/Station';

interface StationPickerProps {
  stations: Station[];
  currentStationId: string | null | undefined;
  onPick: (stationId: string) => void;
  onClose: () => void;
}

export default function StationPicker({
  stations,
  currentStationId,
  onPick,
  onClose,
}: StationPickerProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const disabledStationIds = useSystemStore((s) => s.disabledStationIds);

  // Hide stations the user has disabled in Settings → Account. Currently
  // playing stations stay playing even if disabled — the picker just hides
  // them; user can stop manually or re-enable in settings.
  const visibleStations = useMemo(() => {
    if (disabledStationIds.length === 0) return stations;
    const disabled = new Set(disabledStationIds);
    return stations.filter((s) => !disabled.has(s.id));
  }, [stations, disabledStationIds]);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.radio.stations_label}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-80 rounded-card border border-primary/10 bg-background shadow-elevation-3 overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-primary/8 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-foreground/60" />
        <span className="typo-caption font-medium text-foreground/85">
          {t.radio.stations_label}
        </span>
      </div>
      <ul className="py-1 max-h-72 overflow-y-auto">
        {visibleStations.length === 0 && (
          <li className="px-3 py-3 typo-caption text-foreground/55 text-center">
            {t.radio.picker_empty}
          </li>
        )}
        {visibleStations.map((station) => {
          const active = station.id === currentStationId;
          const isYt = station.source.kind === 'youtubeTracks';
          const trackCount =
            station.source.kind === 'youtubeTracks' ? station.source.tracks.length : null;
          return (
            <li key={station.id}>
              <button
                type="button"
                onClick={() => onPick(station.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 typo-body text-left transition-colors ${
                  active
                    ? 'bg-secondary/40'
                    : 'hover:bg-secondary/20'
                }`}
              >
                <span
                  aria-hidden
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ background: station.accentColor }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 min-w-0">
                    <p className="typo-body font-medium truncate">{station.name}</p>
                    {station.sourceLabel && (
                      <span className="ml-auto shrink-0 typo-caption text-foreground/60 px-1.5 py-0.5 rounded bg-secondary/30 flex items-center gap-1">
                        {isYt ? (
                          <Music className="w-3 h-3 text-foreground/55" />
                        ) : (
                          <Radio className="w-3 h-3 text-foreground/55" />
                        )}
                        {station.sourceLabel}
                      </span>
                    )}
                  </div>
                  <p className="typo-caption text-foreground/60 truncate">
                    {station.description}
                    {trackCount !== null && (
                      <span className="text-foreground/45"> · {trackCount}</span>
                    )}
                  </p>
                </div>
                {active && <Check className="w-4 h-4 text-foreground/80 shrink-0" />}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
