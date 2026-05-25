import { Check, Globe } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore } from '@/stores/themeStore';
import type { TimezoneMode } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';

// IANA timezone values are technical identifiers (passed verbatim to date
// formatters); only the display label and description translate. Keys live
// under t.settings.appearance.tz_{label,description}_*.
type TimezoneLabelKey =
  | 'tz_label_local' | 'tz_label_utc' | 'tz_label_us_eastern'
  | 'tz_label_us_central' | 'tz_label_us_pacific' | 'tz_label_london'
  | 'tz_label_prague' | 'tz_label_tokyo';
type TimezoneDescriptionKey =
  | 'tz_description_local' | 'tz_description_utc' | 'tz_description_us_eastern'
  | 'tz_description_us_central' | 'tz_description_us_pacific' | 'tz_description_london'
  | 'tz_description_prague' | 'tz_description_tokyo';

const TIMEZONE_OPTIONS: Array<{ value: string; labelKey: TimezoneLabelKey; descriptionKey: TimezoneDescriptionKey }> = [
  { value: 'local', labelKey: 'tz_label_local', descriptionKey: 'tz_description_local' },
  { value: 'utc', labelKey: 'tz_label_utc', descriptionKey: 'tz_description_utc' },
  { value: 'America/New_York', labelKey: 'tz_label_us_eastern', descriptionKey: 'tz_description_us_eastern' },
  { value: 'America/Chicago', labelKey: 'tz_label_us_central', descriptionKey: 'tz_description_us_central' },
  { value: 'America/Los_Angeles', labelKey: 'tz_label_us_pacific', descriptionKey: 'tz_description_us_pacific' },
  { value: 'Europe/London', labelKey: 'tz_label_london', descriptionKey: 'tz_description_london' },
  { value: 'Europe/Prague', labelKey: 'tz_label_prague', descriptionKey: 'tz_description_prague' },
  { value: 'Asia/Tokyo', labelKey: 'tz_label_tokyo', descriptionKey: 'tz_description_tokyo' },
];

/** Timezone selector — controls how every RelativeTime / date renders. */
export default function AppearanceTimezoneSettings() {
  const { t } = useTranslation();
  const timezone = useThemeStore((s) => s.timezone);
  const setTimezone = useThemeStore((s) => s.setTimezone);
  const s = t.settings.appearance;

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-4">
      <SectionHeading title={s.timezone} icon={<Globe />} />
      <p className="typo-caption text-foreground">{s.timezone_hint}</p>
      <div className="grid grid-cols-2 2xl:grid-cols-3 gap-3">
        {TIMEZONE_OPTIONS.map((tz) => {
          const isActive = timezone === tz.value;
          return (
            <button
              type="button"
              key={tz.value}
              onClick={() => setTimezone(tz.value as TimezoneMode)}
              className={`relative flex flex-col items-center gap-2 p-4 rounded-modal border transition-colors text-center ${
                isActive
                  ? 'border-primary/30 bg-primary/5'
                  : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
              }`}
            >
              <span className={`typo-heading font-medium ${isActive ? 'text-foreground/90' : 'text-foreground'}`}>
                {s[tz.labelKey]}
              </span>
              <span className="typo-caption text-foreground leading-snug">{s[tz.descriptionKey]}</span>
              {isActive && (
                <div className="absolute top-2 right-2">
                  <Check className="w-3.5 h-3.5 text-primary" />
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
