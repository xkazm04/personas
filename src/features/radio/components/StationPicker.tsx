import { useEffect, useRef } from 'react';
import { Check, Radio } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
      className="absolute bottom-full right-0 mb-2 w-64 rounded-card border border-primary/10 bg-card-bg shadow-elevation-3 overflow-hidden"
    >
      <div className="px-3 py-2 border-b border-primary/8 flex items-center gap-2">
        <Radio className="w-3.5 h-3.5 text-foreground/60" />
        <span className="typo-caption font-medium text-foreground/85">
          {t.radio.stations_label}
        </span>
      </div>
      <ul className="py-1 max-h-72 overflow-y-auto">
        {stations.map((station) => {
          const active = station.id === currentStationId;
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
                  <p className="typo-body font-medium truncate">{station.name}</p>
                  <p className="typo-caption text-foreground/60 truncate">
                    {station.sourceLabel ?? station.description}
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
