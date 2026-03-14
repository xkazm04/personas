import { useState, useMemo } from 'react';
import { Paintbrush, Sun, Moon, ChevronRight, RotateCcw } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import type { CustomThemeConfig } from '@/stores/themeStore';
import { deriveCustomThemeVars } from '@/lib/theme/deriveCustomTheme';
import { ColorPicker } from '@/features/shared/components/forms/ColorPicker';
import { Button } from '@/features/shared/components/buttons';

// ---------------------------------------------------------------------------
// Mini preview — shows derived colors in a miniature app layout
// ---------------------------------------------------------------------------

function ThemePreview({ vars }: { vars: Record<string, string> }) {
  const bg = vars['--background'];
  const fg = vars['--foreground'];
  const primary = vars['--primary'];
  const accent = vars['--accent'];
  const secondary = vars['--secondary'];
  const border = vars['--border'];
  const muted = vars['--muted-foreground'];
  const cardBg = vars['--card-bg'];
  const cardBorder = vars['--card-border'];
  const btnPrimary = vars['--btn-primary'];

  return (
    <div
      className="rounded-xl overflow-hidden border"
      style={{ backgroundColor: bg, borderColor: border, color: fg }}
    >
      <div className="flex" style={{ minHeight: 120 }}>
        {/* Sidebar mock */}
        <div
          className="w-12 flex-shrink-0 flex flex-col items-center gap-2 py-3 border-r"
          style={{ backgroundColor: secondary, borderColor: border }}
        >
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: primary, opacity: 0.9 }} />
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: fg, opacity: 0.08 }} />
          <div className="w-5 h-5 rounded-md" style={{ backgroundColor: fg, opacity: 0.08 }} />
        </div>

        {/* Main area */}
        <div className="flex-1 p-3 space-y-2.5">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: primary }} />
              <span className="text-xs font-semibold" style={{ color: fg }}>Dashboard</span>
            </div>
            <div
              className="px-2 py-0.5 rounded-md text-[9px] font-medium"
              style={{ backgroundColor: btnPrimary, color: '#fff' }}
            >
              Action
            </div>
          </div>

          {/* Card mock */}
          <div
            className="rounded-lg p-2.5 space-y-1.5 border"
            style={{ backgroundColor: cardBg, borderColor: cardBorder }}
          >
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: accent }} />
              <span className="text-[10px] font-medium" style={{ color: fg }}>Card Title</span>
            </div>
            <div className="h-px" style={{ backgroundColor: border }} />
            <span className="text-[9px] block" style={{ color: muted }}>
              Muted description text with secondary content
            </span>
          </div>

          {/* Status dots */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-success'] }} />
              <span className="text-[8px]" style={{ color: muted }}>OK</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-warning'] }} />
              <span className="text-[8px]" style={{ color: muted }}>Warn</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: vars['--status-error'] }} />
              <span className="text-[8px]" style={{ color: muted }}>Err</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function CustomThemeCreator() {
  const existingConfig = useThemeStore((s) => s.customTheme);
  const setCustomTheme = useThemeStore((s) => s.setCustomTheme);
  const clearCustomTheme = useThemeStore((s) => s.clearCustomTheme);
  const currentThemeId = useThemeStore((s) => s.themeId);

  // Local draft state — initialized from store or defaults
  const [baseMode, setBaseMode] = useState<'dark' | 'light'>(existingConfig?.baseMode ?? 'dark');
  const [primaryColor, setPrimaryColor] = useState(existingConfig?.primaryColor ?? '#8b5cf6');
  const [accentColor, setAccentColor] = useState<string | null>(existingConfig?.accentColor ?? null);
  const [label, setLabel] = useState(existingConfig?.label ?? 'Custom');
  const [showAccent, setShowAccent] = useState(accentColor !== null);

  const draftConfig: CustomThemeConfig = useMemo(() => ({
    baseMode,
    primaryColor,
    accentColor: showAccent ? accentColor : null,
    label,
  }), [baseMode, primaryColor, accentColor, label, showAccent]);

  const derivedVars = useMemo(() => deriveCustomThemeVars(draftConfig), [draftConfig]);

  const isDirty = !existingConfig
    || existingConfig.baseMode !== draftConfig.baseMode
    || existingConfig.primaryColor !== draftConfig.primaryColor
    || existingConfig.accentColor !== draftConfig.accentColor
    || existingConfig.label !== draftConfig.label;

  const handleSave = () => {
    setCustomTheme(draftConfig);
  };

  const handleReset = () => {
    clearCustomTheme();
    setBaseMode('dark');
    setPrimaryColor('#8b5cf6');
    setAccentColor(null);
    setShowAccent(false);
    setLabel('Custom');
  };

  const isActiveCustom = currentThemeId === 'custom';

  return (
    <div className="rounded-xl border border-primary/10 bg-card-bg p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <Paintbrush className="w-4 h-4 text-muted-foreground/70" />
        <h2 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">Custom Theme</h2>
        {isActiveCustom && (
          <span className="text-[10px] font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-0.5">
            Active
          </span>
        )}
      </div>

      <p className="text-xs text-muted-foreground/60">
        Create your own theme by choosing a base mode and primary color. All other colors are derived automatically.
      </p>

      {/* Base mode toggle */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground/80">Base Mode</label>
        <div className="flex gap-2">
          {(['dark', 'light'] as const).map((mode) => {
            const active = baseMode === mode;
            const Icon = mode === 'dark' ? Moon : Sun;
            return (
              <button
                key={mode}
                onClick={() => setBaseMode(mode)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                  active
                    ? 'border-primary/30 bg-primary/10 text-foreground/90'
                    : 'border-primary/10 text-muted-foreground/60 hover:border-primary/20 hover:bg-primary/5'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {mode === 'dark' ? 'Dark' : 'Light'}
              </button>
            );
          })}
        </div>
      </div>

      {/* Theme name */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground/80">Theme Name</label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Custom"
          maxLength={24}
          className="w-full max-w-xs px-3 py-2 bg-background/50 border border-primary/15 rounded-xl text-sm text-foreground placeholder-muted-foreground/30 focus-ring transition-all"
        />
      </div>

      {/* Primary color */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground/80">Primary Color</label>
        <ColorPicker value={primaryColor} onChange={setPrimaryColor} size="sm" />
      </div>

      {/* Accent color (collapsible) */}
      <div className="space-y-2">
        <button
          onClick={() => {
            const next = !showAccent;
            setShowAccent(next);
            if (!next) setAccentColor(null);
          }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
        >
          <ChevronRight className={`w-3 h-3 transition-transform ${showAccent ? 'rotate-90' : ''}`} />
          Customize accent color
        </button>
        {showAccent && (
          <div className="pl-4">
            <ColorPicker
              value={accentColor ?? derivedVars['--accent'] ?? primaryColor}
              onChange={setAccentColor}
              size="sm"
            />
          </div>
        )}
      </div>

      {/* Live preview */}
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground/80">Preview</label>
        <ThemePreview vars={derivedVars} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 pt-1">
        <Button
          variant="accent"
          accentColor="violet"
          size="sm"
          icon={<Paintbrush className="w-3.5 h-3.5" />}
          onClick={handleSave}
          disabled={!label.trim()}
          disabledReason="Enter a theme name"
        >
          {isDirty ? 'Save & Apply' : 'Applied'}
        </Button>
        {existingConfig && (
          <Button
            variant="ghost"
            size="sm"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
            onClick={handleReset}
          >
            Reset
          </Button>
        )}
      </div>
    </div>
  );
}
