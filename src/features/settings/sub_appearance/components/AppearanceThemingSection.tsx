import { useMemo, useState } from 'react';
import { Palette } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useThemeStore, THEMES, customThemeDef } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AppearanceThemeSwatch } from './AppearanceThemeSwatch';
import CustomThemeCreator from './CustomThemeCreator';

const TABS_PREFIX = 'appearance-theming';

/** Theme picker — default dark/light grids + the custom-theme creator tab. */
export default function AppearanceThemingSection() {
  const { t } = useTranslation();
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const customTheme = useThemeStore((s) => s.customTheme);
  const labels = t.settings.appearance;

  const [themeTab, setThemeTab] = useState<'default' | 'custom'>('default');
  // The editor mounts on first visit and then stays mounted (hidden), so its draft survives tab
  // switches without a never-opened editor re-rendering on every theme change.
  const [customVisited, setCustomVisited] = useState(false);
  const handleTabChange = (tab: 'default' | 'custom') => {
    setThemeTab(tab);
    if (tab === 'custom') setCustomVisited(true);
  };

  const customDef = useMemo(() => (customTheme ? customThemeDef(customTheme) : null), [customTheme]);
  const { darkThemes, lightThemes } = useMemo(() => {
    const dark = THEMES.filter((th) => !th.isLight);
    const light = THEMES.filter((th) => th.isLight);
    return {
      darkThemes: customDef && !customDef.isLight ? [...dark, customDef] : dark,
      lightThemes: customDef && customDef.isLight ? [...light, customDef] : light,
    };
  }, [customDef]);

  return (
    <SectionCard
      title={labels.theming}
      icon={<Palette className="w-4 h-4 text-violet-400" />}
      titleClassName="text-primary"
      action={
        <SegmentedTabs<'default' | 'custom'>
          variant="segment"
          ariaLabel={labels.theming}
          idPrefix={TABS_PREFIX}
          activeTab={themeTab}
          onTabChange={handleTabChange}
          tabs={[
            { id: 'default', label: labels.default_tab },
            { id: 'custom', label: labels.custom_tab },
          ]}
        />
      }
    >
      {/* The editor's draft lives in its local state, so unmounting it on a tab switch discarded
          unsaved colour picks: the panel is hidden, not removed, once visited. */}
      <div {...segmentedTabPanelProps(TABS_PREFIX, 'default')} hidden={themeTab !== 'default'}>
        <div className="space-y-4">
          <div className="space-y-2">
            <span className="typo-body text-foreground">{labels.dark}</span>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {darkThemes.map((th) => (
                <AppearanceThemeSwatch key={th.id} theme={th} active={themeId === th.id} onSelect={setTheme} />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <span className="typo-body text-foreground">{labels.light}</span>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
              {lightThemes.map((th) => (
                <AppearanceThemeSwatch key={th.id} theme={th} active={themeId === th.id} onSelect={setTheme} />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div {...segmentedTabPanelProps(TABS_PREFIX, 'custom')} hidden={themeTab !== 'custom'}>
        {customVisited && <CustomThemeCreator />}
      </div>
    </SectionCard>
  );
}
