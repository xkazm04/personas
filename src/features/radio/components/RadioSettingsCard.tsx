import { Radio } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useTranslation } from '@/i18n/useTranslation';
import { useRadioState } from '../hooks/useRadioState';

/**
 * Settings → Account section that introduces the radio feature and previews
 * the curated stations + their tracklists. Read-only — playback control
 * lives in the footer.
 */
export default function RadioSettingsCard() {
  const { t } = useTranslation();
  const { stations, loaded } = useRadioState();
  if (!loaded) return null;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading
        title={t.radio.settings_title}
        icon={<Radio className="text-violet-400" />}
      />
      <p className="typo-body text-foreground leading-relaxed">
        {t.radio.settings_description}
      </p>
      <ul className="space-y-3">
        {stations.map((station) => (
          <li
            key={station.id}
            className="rounded-card border border-primary/8 bg-secondary/15 p-4"
          >
            <div className="flex items-center gap-2 mb-2">
              <span
                aria-hidden
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ background: station.accentColor }}
              />
              <p className="typo-body font-medium text-foreground/90">{station.name}</p>
              <span className="typo-caption text-foreground/55 ml-auto">
                {station.tracks.length === 1
                  ? t.radio.track_count_one
                  : t.radio.track_count_other.replace('{count}', String(station.tracks.length))}
              </span>
            </div>
            <p className="typo-caption text-foreground/60 mb-2">{station.description}</p>
            <ul className="space-y-1">
              {station.tracks.map((track) => (
                <li
                  key={track.videoId}
                  className="typo-caption text-foreground/75 truncate flex gap-2"
                  title={`${track.title} — ${track.artist}`}
                >
                  <span className="text-foreground/40 shrink-0">{track.artist}</span>
                  <span className="text-foreground/40">·</span>
                  <span className="truncate">{track.title}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
