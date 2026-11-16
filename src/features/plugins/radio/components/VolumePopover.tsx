import { useRef, type RefObject } from 'react';
import { Volume1, Volume2, VolumeX } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

import Button from '@/features/shared/components/buttons/Button';

interface VolumePopoverProps {
  volume: number;
  accentColor: string;
  onChange: (volume: number) => void;
  onMuteToggle: () => void;
  onClose: () => void;
  /** Wrapper holding the trigger that toggles this popover. */
  anchorRef: RefObject<HTMLElement | null>;
}

export default function VolumePopover({
  volume,
  accentColor,
  onChange,
  onMuteToggle,
  onClose,
  anchorRef,
}: VolumePopoverProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // The anchor holds the trigger: a press on it is not "outside", so the
  // trigger's own toggle closes the popover instead of re-opening it.
  useClickOutside([ref, anchorRef], true, onClose);

  const muted = volume <= 0.001;
  const Icon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const percent = Math.round(volume * 100);

  return (
    <div
      ref={ref}
      role="region"
      aria-label={t.radio.volume_label}
      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 rounded-card border border-primary/10 bg-background shadow-elevation-3 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <Button
          type="button"
          onClick={onMuteToggle}
          aria-label={muted ? t.radio.unmute : t.radio.mute}
          tooltip={muted ? t.radio.unmute : t.radio.mute}
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
        >
          <Icon className="w-3.5 h-3.5" />
        </Button>
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
        <span className="typo-caption text-foreground tabular-nums w-8 text-right">
          {percent}%
        </span>
      </div>
    </div>
  );
}
