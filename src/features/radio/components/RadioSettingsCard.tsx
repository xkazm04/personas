import { Music, Radio } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useRadioState } from '../hooks/useRadioState';

/**
 * Settings → Account section. Three controls:
 *
 *   1. Master enable/disable for the footer controller (top toggle).
 *   2. Auto-resume — when on, the last station starts on app launch.
 *      Grays out when the master switch is off.
 *   3. Per-station enable list — each row is one station with a kind
 *      chip and a toggle that hides the station from the footer picker.
 *
 * All settings are persisted via systemStore so choices survive
 * restarts. The view is read-only beyond toggles — no description, no
 * tracklist, no source link (those lived in earlier verbose layouts).
 */
export default function RadioSettingsCard() {
  const { t } = useTranslation();
  const { state, stations, loaded } = useRadioState();
  const radioEnabled = useSystemStore((s) => s.radioEnabled);
  const setRadioEnabled = useSystemStore((s) => s.setRadioEnabled);
  const disabledStationIds = useSystemStore((s) => s.disabledStationIds);
  const setStationDisabled = useSystemStore((s) => s.setStationDisabled);
  const radioAutoResume = useSystemStore((s) => s.radioAutoResume);
  const setRadioAutoResume = useSystemStore((s) => s.setRadioAutoResume);
  if (!loaded) return null;

  const disabledSet = new Set(disabledStationIds);

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

      <div
        className={`flex items-center justify-between gap-4 rounded-card border border-primary/8 bg-secondary/10 p-3 transition-opacity ${
          radioEnabled ? '' : 'opacity-50 pointer-events-none'
        }`}
      >
        <div className="min-w-0">
          <p className="typo-body font-medium text-foreground">{t.radio.auto_resume_label}</p>
          <p className="typo-caption text-foreground/60">{t.radio.auto_resume_description}</p>
        </div>
        <AccessibleToggle
          checked={radioAutoResume}
          onChange={() => setRadioAutoResume(!radioAutoResume)}
          label={t.radio.auto_resume_label}
        />
      </div>

      <ul className="rounded-card border border-primary/8 bg-secondary/10 divide-y divide-primary/5 overflow-hidden">
        {stations.map((station) => {
          const isYt = station.source.kind === 'youtubeTracks';
          const enabled = !disabledSet.has(station.id);
          const isCurrent = state?.currentStationId === station.id;
          const isPlaying = isCurrent && state?.status === 'playing';
          const isBuffering = isCurrent && state?.status === 'buffering';
          return (
            <li
              key={station.id}
              className="flex items-center gap-3 px-3 py-2"
            >
              <span
                aria-label={isPlaying || isBuffering ? t.radio.now_playing : undefined}
                className={`w-2 h-2 rounded-full shrink-0 ${isBuffering ? 'animate-pulse' : ''}`}
                style={{
                  background: station.accentColor,
                  boxShadow: isPlaying ? `0 0 6px ${station.accentColor}` : 'none',
                  transition: 'box-shadow 200ms',
                }}
              />
              <p className="typo-body font-medium text-foreground truncate flex-1">
                {station.name}
              </p>
              <span className="shrink-0 typo-caption text-foreground/55 px-1.5 py-0.5 rounded bg-secondary/30 flex items-center gap-1">
                {isYt ? <Music className="w-3 h-3" /> : <Radio className="w-3 h-3" />}
                {station.sourceLabel ?? (isYt ? t.radio.kind_youtube : t.radio.kind_stream)}
              </span>
              <AccessibleToggle
                checked={enabled}
                onChange={() => setStationDisabled(station.id, enabled)}
                label={t.radio.station_toggle_label}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
