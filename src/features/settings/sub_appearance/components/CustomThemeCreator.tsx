import { useState, useMemo } from 'react';
import { Paintbrush, Sun, Moon, ChevronRight, RotateCcw } from 'lucide-react';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { useThemeStore } from '@/stores/themeStore';
import type { CustomThemeConfig } from '@/stores/themeStore';
import { deriveCustomThemeVars } from '@/lib/theme/deriveCustomTheme';
import { Button } from '@/features/shared/components/buttons';
import { ColorRow } from './ColorRow';
import { ThemePreview } from './ThemePreview';
import { useTranslation } from '@/i18n/useTranslation';

export default function CustomThemeCreator() {
  const existingConfig = useThemeStore((s) => s.customTheme);
  const setCustomTheme = useThemeStore((s) => s.setCustomTheme);
  const clearCustomTheme = useThemeStore((s) => s.clearCustomTheme);
  const currentThemeId = useThemeStore((s) => s.themeId);
  const { t } = useTranslation();
  const s = t.settings.appearance;

  // Local draft state — initialized from store or defaults
  const [baseMode, setBaseMode] = useState<'dark' | 'light'>(existingConfig?.baseMode ?? 'dark');
  const [primaryColor, setPrimaryColor] = useState(existingConfig?.primaryColor ?? '#8b5cf6');
  const [accentColor, setAccentColor] = useState<string | null>(existingConfig?.accentColor ?? null);
  const [label, setLabel] = useState(existingConfig?.label ?? 'Custom');

  // Extended color overrides
  const [backgroundColor, setBackgroundColor] = useState<string | null>(existingConfig?.backgroundColor ?? null);
  const [backgroundEndColor, setBackgroundEndColor] = useState<string | null>(existingConfig?.backgroundEndColor ?? null);
  const [backgroundAngle, setBackgroundAngle] = useState(existingConfig?.backgroundAngle ?? 135);
  const [foregroundColor, setForegroundColor] = useState<string | null>(existingConfig?.foregroundColor ?? null);
  const [secondaryColor, setSecondaryColor] = useState<string | null>(existingConfig?.secondaryColor ?? null);
  const [borderColor, setBorderColor] = useState<string | null>(existingConfig?.borderColor ?? null);
  const [cardBgColor, setCardBgColor] = useState<string | null>(existingConfig?.cardBgColor ?? null);
  const [mutedFgColor, setMutedFgColor] = useState<string | null>(existingConfig?.mutedFgColor ?? null);

  const [showGradient, setShowGradient] = useState(backgroundEndColor !== null);

  const draftConfig: CustomThemeConfig = useMemo(() => ({
    baseMode,
    primaryColor,
    accentColor,
    label,
    backgroundColor,
    backgroundEndColor: showGradient ? backgroundEndColor : null,
    backgroundAngle: showGradient ? backgroundAngle : undefined,
    foregroundColor,
    secondaryColor,
    borderColor,
    cardBgColor,
    mutedFgColor,
  }), [baseMode, primaryColor, accentColor, label, backgroundColor, backgroundEndColor, backgroundAngle, showGradient, foregroundColor, secondaryColor, borderColor, cardBgColor, mutedFgColor]);

  const derivedVars = useMemo(() => deriveCustomThemeVars(draftConfig), [draftConfig]);

  // Compute auto-derived values (without overrides) for showing "auto" defaults
  const baseVars = useMemo(() => deriveCustomThemeVars({
    baseMode, primaryColor, accentColor, label,
  }), [baseMode, primaryColor, accentColor, label]);

  const isDirty = !existingConfig
    || JSON.stringify(existingConfig) !== JSON.stringify(draftConfig);

  const handleSave = () => {
    setCustomTheme(draftConfig);
  };

  const handleReset = () => {
    clearCustomTheme();
    setBaseMode('dark');
    setPrimaryColor('#8b5cf6');
    setAccentColor(null);
    setLabel('Custom');
    setBackgroundColor(null);
    setBackgroundEndColor(null);
    setBackgroundAngle(135);
    setForegroundColor(null);
    setSecondaryColor(null);
    setBorderColor(null);
    setCardBgColor(null);
    setMutedFgColor(null);
    setShowGradient(false);
  };

  const isActiveCustom = currentThemeId === 'custom';

  const colorRows: { label: string; value: string | null; derivedValue: string | undefined; onChange: (c: string | null) => void }[] = useMemo(() => [
    { label: 'Primary', value: primaryColor, derivedValue: '#8b5cf6', onChange: (c: string | null) => setPrimaryColor(c ?? '#8b5cf6') },
    { label: 'Accent', value: accentColor, derivedValue: baseVars['--accent'], onChange: (c: string | null) => setAccentColor(c) },
    { label: 'Background', value: backgroundColor, derivedValue: baseVars['--background'], onChange: (c: string | null) => setBackgroundColor(c) },
    { label: 'Foreground', value: foregroundColor, derivedValue: baseVars['--foreground'], onChange: (c: string | null) => setForegroundColor(c) },
    { label: 'Secondary', value: secondaryColor, derivedValue: baseVars['--secondary'], onChange: (c: string | null) => setSecondaryColor(c) },
    { label: 'Border', value: borderColor, derivedValue: baseVars['--border'], onChange: (c: string | null) => setBorderColor(c) },
    { label: 'Card', value: cardBgColor, derivedValue: baseVars['--card-bg'], onChange: (c: string | null) => setCardBgColor(c) },
    { label: 'Muted Text', value: mutedFgColor, derivedValue: baseVars['--muted-foreground'], onChange: (c: string | null) => setMutedFgColor(c) },
  ], [primaryColor, accentColor, backgroundColor, foregroundColor, secondaryColor, borderColor, cardBgColor, mutedFgColor, baseVars]);

  return (
    <div className="rounded-modal border border-primary/10 bg-card-bg p-6 space-y-5">
      {/* Header */}
      <SectionHeading
        title={s.custom_theme}
        icon={<Paintbrush />}
        action={isActiveCustom ? (
          <span className="text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">{s.custom_theme_active}</span>
        ) : undefined}
      />

      <p className="typo-caption text-foreground">
        {s.custom_theme_hint}
      </p>

      {/* Base mode + theme name */}
      <div className="flex items-end gap-4">
        <div className="space-y-2">
          <label className="typo-caption font-medium text-foreground">{s.base_mode}</label>
          <div className="flex gap-1.5">
            {(['dark', 'light'] as const).map((mode) => {
              const active = baseMode === mode;
              const Icon = mode === 'dark' ? Moon : Sun;
              return (
                <button
                  key={mode}
                  onClick={() => setBaseMode(mode)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-modal border typo-caption font-medium transition-all ${
                    active ? 'border-primary/30 bg-primary/10 text-foreground/90' : 'border-primary/10 text-foreground hover:border-primary/20 hover:bg-primary/5'
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {mode === 'dark' ? s.dark : s.light}
                </button>
              );
            })}
          </div>
        </div>
        <div className="space-y-2 flex-1 max-w-xs">
          <label className="typo-caption font-medium text-foreground">{s.theme_name}</label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Custom"
            maxLength={24}
            className="w-full px-3 py-2 bg-background/50 border border-primary/15 rounded-modal typo-body text-foreground placeholder-muted-foreground/30 focus-ring transition-all"
          />
        </div>
      </div>

      {/* Color rows */}
      <div className="space-y-1">
        <label className="typo-caption font-medium text-foreground">{s.colors}</label>
        <div className="rounded-card border border-primary/8 bg-secondary/10 px-3 py-1 divide-y divide-primary/5">
          {colorRows.map((row) => (
            <ColorRow key={row.label} label={row.label} value={row.value} derivedValue={row.derivedValue} onChange={row.onChange} />
          ))}
        </div>
      </div>

      {/* Background gradient (collapsible) */}
      <div className="space-y-2">
        <button
          onClick={() => { const next = !showGradient; setShowGradient(next); if (!next) setBackgroundEndColor(null); }}
          className="flex items-center gap-1.5 typo-caption text-foreground hover:text-muted-foreground transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showGradient ? 'rotate-90' : ''}`} />
          {s.background_gradient}
        </button>
        {showGradient && (
          <div className="pl-4 space-y-3">
            <div className="rounded-card border border-primary/8 bg-secondary/10 px-3 py-1">
              <ColorRow label="End Color" value={backgroundEndColor} derivedValue={backgroundColor ?? baseVars['--background']} onChange={setBackgroundEndColor} />
            </div>
            <div className="flex items-center gap-3">
              <label className="typo-caption text-foreground w-24 flex-shrink-0">{s.angle}</label>
              <input type="range" min={0} max={360} value={backgroundAngle} onChange={(e) => setBackgroundAngle(Number(e.target.value))} className="flex-1 accent-primary h-1.5" />
              <span className="typo-code font-mono text-foreground w-10 text-right">{backgroundAngle}&deg;</span>
            </div>
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="space-y-2">
        <label className="typo-caption font-medium text-foreground">{s.preview}</label>
        <ThemePreview vars={derivedVars} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button variant="accent" accentColor="violet" size="sm" icon={<Paintbrush className="w-3.5 h-3.5" />} onClick={handleSave} disabled={!label.trim()} disabledReason={s.enter_theme_name}>
          {isDirty ? s.save_apply : s.applied}
        </Button>
        {existingConfig && (
          <Button variant="ghost" size="sm" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={handleReset}>{s.reset}</Button>
        )}
      </div>
    </div>
  );
}
