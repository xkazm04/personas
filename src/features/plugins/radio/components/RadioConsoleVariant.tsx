import { Music, Radio } from 'lucide-react';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import type { Station } from '@/lib/bindings/Station';
import EqualizerBars from './EqualizerBars';
import {
  DESC_STYLE,
  groupStations,
  PreviewButton,
  RadioMasterControls,
  TITLE_STYLE,
  trackCount,
  YouTubePremiumNote,
  type RadioVariantProps,
} from './radioManageShared';

/**
 * Variant A — "Console". The mixing-desk metaphor: each station is a channel
 * strip (accent rail · preview transport · label · live equalizer · keep
 * switch) racked under its provider. Auditioning a strip lights its rail and
 * runs the equalizer so the user can A/B stations like faders on a desk.
 */
export default function RadioConsoleVariant(props: RadioVariantProps) {
  const { t, tx } = useTranslation();
  const { stations, previewingId, bufferingId, onPreview, disabledStationIds, setStationDisabled } = props;
  const groups = groupStations(stations);
  const disabled = new Set(disabledStationIds);

  const strip = (station: Station) => {
    const isPreviewing = previewingId === station.id;
    const isBuffering = bufferingId === station.id;
    const kept = !disabled.has(station.id);
    const count = trackCount(station);
    return (
      <li
        key={station.id}
        className="flex items-center gap-3 rounded-card border bg-secondary/10 px-3 py-2.5 transition-colors"
        style={{
          borderColor: isPreviewing ? `${station.accentColor}66` : 'rgba(255,255,255,0.06)',
          background: isPreviewing ? `${station.accentColor}0f` : undefined,
        }}
      >
        <span className="w-1 self-stretch rounded-full shrink-0" style={{ background: station.accentColor }} />
        <PreviewButton
          accentColor={station.accentColor}
          isPreviewing={isPreviewing}
          isBuffering={isBuffering}
          onClick={() => onPreview(station.id)}
        />
        <div className="min-w-0 flex-1">
          <p className="typo-body font-medium text-foreground truncate" style={TITLE_STYLE}>{station.name}</p>
          <p className="typo-caption text-foreground truncate" style={DESC_STYLE}>
            {station.description}
            {count !== null && <span> · {tx(t.radio.tracklist_label, { count })}</span>}
          </p>
        </div>
        {isPreviewing && (
          <div className="w-16 shrink-0 hidden sm:block">
            <EqualizerBars accentColor={station.accentColor} isPlaying={!isBuffering} />
          </div>
        )}
        <label className="flex items-center gap-1.5 shrink-0 cursor-pointer">
          <span className="typo-caption text-foreground hidden md:inline" style={DESC_STYLE}>{kept ? t.radio.keep_kept : t.radio.keep_hidden}</span>
          <AccessibleToggle
            checked={kept}
            onChange={() => setStationDisabled(station.id, kept)}
            label={t.radio.keep_toggle_label}
          />
        </label>
      </li>
    );
  };

  return (
    <div className="space-y-5">
      <RadioMasterControls {...props} />

      {groups.map((group) => (
        <section key={group.label} className="space-y-2.5">
          <div className="flex items-center gap-2">
            {group.isYouTube ? <Music className="w-4 h-4 text-rose-400" /> : <Radio className="w-4 h-4 text-violet-400" />}
            <h3 className="typo-heading text-primary">{group.label}</h3>
            <span className="typo-caption text-foreground tabular-nums rounded-full bg-secondary/30 px-2 py-0.5">
              {group.stations.length}
            </span>
          </div>
          {group.isYouTube && <YouTubePremiumNote />}
          <ul className="space-y-2">{group.stations.map(strip)}</ul>
        </section>
      ))}
    </div>
  );
}
