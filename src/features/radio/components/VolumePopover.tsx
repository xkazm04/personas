import { useEffect, useRef } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface VolumePopoverProps {
  volume: number;
  accentColor: string;
  onChange: (volume: number) => void;
  onMuteToggle: () => void;
  onClose: () => void;
}

export default function VolumePopover({
  volume,
  accentColor,
  onChange,
  onMuteToggle,
  onClose,
}: VolumePopoverProps) {
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

  const muted = volume <= 0.001;
  const Icon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume * 100);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t.radio.volume_label}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-card border border-primary/10 bg-background shadow-elevation-3 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onMuteToggle}
          className="w-6 h-6 rounded-interactive flex items-center justify-center text-foreground/80 hover:bg-secondary/40 transition-colors shrink-0"
          aria-label={muted ? t.radio.unmute : t.radio.mute}
          title={muted ? t.radio.unmute : t.radio.mute}
        >
          <Icon className="w-3.5 h-3.5" />
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => onChange(Number(e.target.value))}
          className="flex-1 h-1 cursor-pointer"
          style={{ accentColor }}
          aria-label={t.radio.volume_label}
        />
        <span className="typo-caption text-foreground/60 tabular-nums w-8 text-right">
          {percent}%
        </span>
      </div>
    </div>
  );
}
