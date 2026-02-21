import { Check, Palette } from 'lucide-react';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import type { ThemeId } from '@/stores/themeStore';

export default function AppearanceSettings() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="px-4 md:px-6 py-5 border-b border-primary/10 bg-primary/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <Palette className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-foreground/90">Appearance</h1>
            <p className="text-xs text-muted-foreground/50">Customize how the app looks</p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="min-h-full p-6 space-y-6">
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
      </div>
    </div>
  );
}
