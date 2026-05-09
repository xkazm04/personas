import { Radio } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useTranslation } from '@/i18n/useTranslation';
import { useRadioState } from '../hooks/useRadioState';

/**
 * Settings → Account section that introduces the radio feature and lists
 * the curated stations + their stream provider. Read-only — playback control
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
            </div>
            <p className="typo-caption text-foreground/60 mb-2">{station.description}</p>
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
        ))}
      </ul>
    </div>
  );
}
