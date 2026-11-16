import { useThemeStore, TEXT_SCALES } from '@/stores/themeStore';
import type { TextScale } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceOptionTile } from './AppearanceOptionTile';

/** Text-size selector — drives the app-wide `data-text-scale` typography ramp. */
export default function AppearanceTextSizeSettings() {
  const { t } = useTranslation();
  const s = t.settings.appearance;
  const textScale = useThemeStore((st) => st.textScale);
  const setTextScale = useThemeStore((st) => st.setTextScale);

  return (
    <div className="space-y-4">
      <p className="typo-caption">{s.text_size_hint}</p>
      <div className="grid grid-cols-3 gap-3">
        {TEXT_SCALES.map((scale) => {
          const isActive = textScale === scale.id;
          return (
            <AppearanceOptionTile
              key={scale.id}
              active={isActive}
              onSelect={() => setTextScale(scale.id as TextScale)}
              icon={
                <span className="typo-body-lg text-foreground">Aa</span>
              }
              label={s[scale.labelKey]}
              description={s[scale.descriptionKey]}
            />
          );
        })}
      </div>
    </div>
  );
}
