import { useTranslation } from '@/i18n/useTranslation';
import { useState, useRef, useCallback } from 'react';
import { Check, Palette, Type, Sparkles, LayoutGrid, Wrench } from 'lucide-react';
import { useThemeStore, THEMES, TEXT_SCALES } from '@/stores/themeStore';
import { useSystemStore } from "@/stores/systemStore";
import type { ThemeId, ThemeDefinition, TextScale } from '@/stores/themeStore';
import { VIEW_MODES } from '@/lib/constants/uiModes';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';

function ThemePreviewTooltip({ theme }: { theme: ThemeDefinition }) {
  const { backgroundSample, foregroundSample, primaryColor, accentColor } = theme;
  // Use the theme's own background behind the label so it's legible on any active theme
  const borderColor = theme.isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.12)';
  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 animate-expand-in pointer-events-none" style={{ zIndex: 99999 }}>
      <div
        className="w-[140px] rounded-lg overflow-hidden flex flex-col"
        style={{ backgroundColor: backgroundSample, border: `1px solid ${borderColor}`, boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}
      >
        {/* Mini UI preview */}
        <div className="h-[70px] flex flex-col justify-center px-3 gap-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: primaryColor }} />
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: accentColor }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: foregroundSample, opacity: 0.2 }} />
          </div>
          <div className="flex gap-1">
            <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.12 }} />
            <div className="h-1 w-5 rounded-full" style={{ backgroundColor: primaryColor, opacity: 0.5 }} />
          </div>
          <div className="flex gap-1">
            <div className="h-1 w-8 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.08 }} />
            <div className="h-1 flex-1 rounded-full" style={{ backgroundColor: foregroundSample, opacity: 0.08 }} />
          </div>
        </div>
        {/* Label -- rendered ON the theme's own background for proper contrast */}
        <div
          className="text-[10px] text-center py-1.5 font-semibold tracking-wide"
          style={{ color: foregroundSample, borderTop: `1px solid ${borderColor}` }}
        >
          {theme.label}
        </div>
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
    <Button
      variant="ghost"
      onClick={onSelect}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      className={`group relative flex flex-col items-center gap-2 p-3 rounded-xl border ${
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
        {active && <Check className="w-4 h-4 text-white drop-shadow-elevation-1" />}
      </div>
      <span className={`text-sm ${active ? 'text-foreground/90 font-medium' : 'text-muted-foreground/80'}`}>
        {theme.label}
      </span>
    </Button>
  );
}

export default function AppearanceSettings() {
  const { t } = useTranslation();
  const st = t.settings.appearance;
  const se = t.settings.appearance_extra;
  const themeId = useThemeStore((s) => s.themeId);
  const setTheme = useThemeStore((s) => s.setTheme);
  const textScale = useThemeStore((s) => s.textScale);
  const setTextScale = useThemeStore((s) => s.setTextScale);
  const viewMode = useSystemStore((s) => s.viewMode);
  const setViewMode = useSystemStore((s) => s.setViewMode);

  const darkThemes = THEMES.filter((t) => !t.isLight);
  const lightThemes = THEMES.filter((t) => t.isLight);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Palette className="w-5 h-5 text-violet-400" />}
        iconColor="violet"
        title={st.title}
        subtitle={st.subtitle}
      />

      <ContentBody centered>
        <div className="space-y-6">
          {/* View mode toggle */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-violet-400" />
              <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{st.interface_mode}</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Button
                variant="ghost"
                onClick={() => setViewMode(VIEW_MODES.SIMPLE)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                  viewMode === VIEW_MODES.SIMPLE
                    ? 'border-violet-500/30 bg-violet-500/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Sparkles className={`w-5 h-5 ${viewMode === VIEW_MODES.SIMPLE ? 'text-violet-400' : 'text-muted-foreground/50'}`} />
                <span className={`text-sm font-medium ${viewMode === VIEW_MODES.SIMPLE ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>{se.simple}</span>
                <span className="text-[11px] text-muted-foreground/50 text-center">{se.simple_hint}</span>
                {viewMode === VIEW_MODES.SIMPLE && (
                  <div className="absolute top-2 right-2"><Check className="w-3.5 h-3.5 text-violet-400" /></div>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setViewMode(VIEW_MODES.FULL)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                  viewMode === VIEW_MODES.FULL
                    ? 'border-primary/30 bg-primary/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <LayoutGrid className={`w-5 h-5 ${viewMode === VIEW_MODES.FULL ? 'text-foreground/80' : 'text-muted-foreground/50'}`} />
                <span className={`text-sm font-medium ${viewMode === VIEW_MODES.FULL ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>{se.full}</span>
                <span className="text-[11px] text-muted-foreground/50 text-center">{se.full_hint}</span>
                {viewMode === VIEW_MODES.FULL && (
                  <div className="absolute top-2 right-2"><Check className="w-3.5 h-3.5 text-primary" /></div>
                )}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setViewMode(VIEW_MODES.DEV)}
                className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                  viewMode === VIEW_MODES.DEV
                    ? 'border-amber-500/30 bg-amber-500/5'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Wrench className={`w-5 h-5 ${viewMode === VIEW_MODES.DEV ? 'text-amber-400' : 'text-muted-foreground/50'}`} />
                <span className={`text-sm font-medium ${viewMode === VIEW_MODES.DEV ? 'text-foreground/90' : 'text-muted-foreground/70'}`}>{se.dev}</span>
                <span className="text-[11px] text-muted-foreground/50 text-center">{se.dev_hint}</span>
                {viewMode === VIEW_MODES.DEV && (
                  <div className="absolute top-2 right-2"><Check className="w-3.5 h-3.5 text-amber-400" /></div>
                )}
              </Button>
            </div>
          </div>
          {/* Dark themes */}
          <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-4">
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{st.dark}</h2>
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
            <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{st.light}</h2>
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
              <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">{st.text_size}</h2>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {TEXT_SCALES.map((scale) => {
                const isActive = textScale === scale.id;
                return (
                  <Button
                    variant="ghost"
                    key={scale.id}
                    onClick={() => setTextScale(scale.id as TextScale)}
                    className={`relative flex flex-col items-center gap-2 p-4 rounded-xl border ${
                      isActive
                        ? 'border-primary/30 bg-primary/5'
                        : 'border-primary/10 hover:border-primary/20 hover:bg-primary/5'
                    }`}
                  >
                    <span
                      className={`font-semibold ${
                        scale.id === 'large' ? 'text-base' :
                        scale.id === 'larger' ? 'text-lg' : 'text-xl'
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
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </ContentBody>
    </ContentBox>
  );
}
