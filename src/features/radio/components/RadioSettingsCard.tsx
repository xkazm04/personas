import { Music, Radio } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useRadioState } from '../hooks/useRadioState';

/**
 * Settings → Account section that introduces the radio feature, lets the
 * user enable/disable it (default off, persisted), and lists the curated
 * catalog. Each station card shows its provider attribution plus, for
 * YouTube stations, the curated tracklist. Read-only — playback control
 * lives in the footer.
 */
export default function RadioSettingsCard() {
  const { t } = useTranslation();
  const { stations, loaded } = useRadioState();
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  const setRadioEnabled = useSystemStore((s) => s.setRadioEnabled);
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

      <div className="flex items-center justify-between gap-4 rounded-card border border-primary/8 bg-secondary/10 p-3">
        <div className="min-w-0">
          <p className="typo-body font-medium text-foreground">{t.radio.enable_label}</p>
          <p className="typo-caption text-foreground/60">{t.radio.enable_description}</p>
        </div>
        <AccessibleToggle
          checked={radioEnabled}
          onChange={() => setRadioEnabled(!radioEnabled)}
          label={t.radio.enable_label}
        />
      </div>

      <ul className="space-y-3">
        {stations.map((station) => {
          const isYt = station.source.kind === 'youtubeTracks';
          return (
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
                <span className="ml-auto flex items-center gap-1 typo-caption text-foreground/55">
                  {isYt ? <Music className="w-3 h-3" /> : <Radio className="w-3 h-3" />}
                  {isYt ? t.radio.kind_youtube : t.radio.kind_stream}
                </span>
              </div>
              <p className="typo-caption text-foreground/60 mb-2">{station.description}</p>

              {station.source.kind === 'youtubeTracks' ? (
                <ul className="space-y-1 mb-2">
                  {station.source.tracks.map((track) => (
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
              ) : null}

              {station.sourceLabel && (
                <p className="typo-caption text-foreground/55">
                  <span className="text-foreground/40">{t.radio.source_prefix} </span>
                  {station.sourceUrl ? (
                    <a
                      href={station.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-foreground/75 hover:text-foreground/90 underline-offset-2 hover:underline"
                    >
                      {station.sourceLabel}
                    </a>
                  ) : (
                    <span className="text-foreground/75">{station.sourceLabel}</span>
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
