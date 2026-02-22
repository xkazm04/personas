import { Check, Palette } from 'lucide-react';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/ContentLayout';

export default function AppearanceSettings() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title="Appearance"
        subtitle="Customize how the app looks"
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* Dark themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider">Dark</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {darkThemes.map((t) => {
                const active = themeId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeId)}
                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                      active
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-full border-2 border-black/10 flex items-center justify-center"
                      style={{ backgroundColor: t.primaryColor }}
                    >
                      {active && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
                    </div>
                    <span className={`text-xs ${active ? 'text-foreground/90 font-medium' : 'text-muted-foreground/60'}`}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Light themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-xs font-mono text-muted-foreground/50 uppercase tracking-wider">Light</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {lightThemes.map((t) => {
                const active = themeId === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id as ThemeId)}
                    className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
                      active
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <div
                      className="w-10 h-10 rounded-full border-2 border-black/10 flex items-center justify-center"
                      style={{ backgroundColor: t.primaryColor }}
                    >
                      {active && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
                    </div>
                    <span className={`text-xs ${active ? 'text-foreground/90 font-medium' : 'text-muted-foreground/60'}`}>
                      {t.label}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
