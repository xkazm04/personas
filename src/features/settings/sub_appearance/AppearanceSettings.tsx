import { useState, useRef, useCallback } from 'react';
import { Check, Palette, Type } from 'lucide-react';
import { useThemeStore, THEMES, TEXT_SCALES } from '@/stores/themeStore';
import type { ThemeId, ThemeDefinition, TextScale } from '@/stores/themeStore';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';

function ThemePreviewTooltip({ theme }: { theme: ThemeDefinition }) {
  const { backgroundSample, foregroundSample, primaryColor, accentColor } = theme;
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 animate-expand-in pointer-events-none">
      <div
        className="w-[120px] h-[80px] rounded-lg border border-black/20 shadow-lg overflow-hidden flex flex-col"
        style={{ backgroundColor: backgroundSample }}
      >
        <div className="flex-1 flex items-center justify-center gap-1.5 px-2">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: primaryColor }} />
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accentColor }} />
          <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: foregroundSample, opacity: 0.25 }} />
        </div>
        <div className="flex gap-1 px-2 pb-1.5">
          <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.15 }} />
          <div className="h-1 w-4 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.5 }} />
        </div>
      </div>
      <div
        className="text-[10px] text-center mt-1 font-medium"
        style={{ color: foregroundSample }}
      >
        {theme.label}
      </div>
    </div>
  );
}

function ThemeSwatch({ theme, active, onSelect }: { theme: ThemeDefinition; active: boolean; onSelect: () => void }) {
  const [showPreview, setShowPreview] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleEnter = useCallback(() => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    setShowPreview(true);
  }, []);

  const handleLeave = useCallback(() => {
    leaveTimer.current = setTimeout(() => setShowPreview(false), 300);
  }, []);

  return (
    <button
      onClick={onSelect}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border transition-all ${
        active
          ? 'border-primary/30 bg-primary/5'
          : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
      }`}
    >
      {showPreview && !active && <ThemePreviewTooltip theme={theme} />}
      <div
        className="w-10 h-10 rounded-full border-2 border-black/10 flex items-center justify-center"
        style={{ backgroundColor: theme.primaryColor }}
      >
        {active && <Check className="w-4 h-4 text-white drop-shadow-sm" />}
      </div>
      <span className={`text-sm ${active ? 'text-foreground/90 font-medium' : 'text-muted-foreground/80'}`}>
        {theme.label}
      </span>
    </button>
  );
}

export default function AppearanceSettings() {
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);

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
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Dark</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {darkThemes.map((t) => (
                <ThemeSwatch
                  key={t.id}
                  theme={t}
                  active={themeId === t.id}
                  onSelect={() => setTheme(t.id as ThemeId)}
                />
              ))}
            </div>
          </div>

          {/* Light themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Light</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
              {lightThemes.map((t) => (
                <ThemeSwatch
                  key={t.id}
                  theme={t}
                  active={themeId === t.id}
                  onSelect={() => setTheme(t.id as ThemeId)}
                />
              ))}
            </div>
          </div>

          {/* Text sizing */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Type className="w-4 h-4 text-muted-foreground/70" />
              <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Text Size</h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {TEXT_SCALES.map((scale) => {
                const isActive = textScale === scale.id;
                return (
                  <button
                    key={scale.id}
                    onClick={() => setTextScale(scale.id as TextScale)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span
                      className={`font-semibold ${
                        scale.id === 'large'
                          ? 'text-base'
                          : 'text-lg'
                      } ${isActive ? 'text-foreground/90' : 'text-muted-foreground/70'}`}
                    >
                      Aa
                    </span>
                    <span className={`text-xs ${isActive ? 'text-foreground/80 font-medium' : 'text-muted-foreground/60'}`}>
                      {scale.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground/50">
                      {scale.description}
                    </span>
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
        </div>
      </ContentBody>
    </ContentBox>
  );
}
