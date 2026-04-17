import { useState } from 'react';
import { ICON_STYLES } from './iconStyles';
import { ICONS, type IconMode } from './iconData';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';

export default function IconShowcase() {
  const [mode, setMode] = useState<IconMode>('custom');
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);
  const { t } = useTranslation();
  const ic = t.home.icon_showcase;

  return (
    <div className="space-y-6 w-full max-w-xl mx-auto">
      {/* Inject animation styles */}
      <style>{ICON_STYLES}</style>

      {/* Switcher */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex bg-secondary/40 p-1 rounded-card border border-border/50">
          <Button
            variant={mode === 'lucide' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setMode('lucide')}
            className={mode === 'lucide' ? 'shadow-elevation-1' : ''}
          >
            {ic.lucide_tab}
          </Button>
          <Button
            variant={mode === 'custom' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setMode('custom')}
            className={mode === 'custom' ? 'shadow-elevation-1' : ''}
          >
            {ic.personas_tab}
          </Button>
        </div>
      </div>

      {/* Icon grid */}
      <div className="grid grid-cols-9 gap-2">
        {ICONS.map((icon, _i) => (
            <div
              key={`${icon.id}-${mode}`}
              className="animate-fade-slide-in flex flex-col items-center gap-1.5"
              onMouseEnter={() => setHoveredIcon(icon.id)}
              onMouseLeave={() => setHoveredIcon(null)}
            >
              <div className={`relative w-11 h-11 p-2 rounded-modal border transition-all duration-300 cursor-default ${
                hoveredIcon === icon.id
                  ? 'border-primary/40 bg-primary/10 shadow-elevation-3 shadow-primary/10 scale-110'
                  : 'border-primary/10 bg-secondary/20'
              } ${mode === 'custom' ? 'text-primary' : 'text-muted-foreground'}`}>
                {mode === 'lucide' ? icon.lucide : icon.custom}
              </div>
              <span className="text-[9px] text-muted-foreground/60 font-medium leading-none">
                {icon.label}
              </span>
            </div>
          ))}
      </div>

      {/* Hover detail */}
      <div className="h-5 flex items-center justify-center">
        {hoveredIcon && mode === 'custom' && (
            <p
              key={hoveredIcon}
              className="animate-fade-slide-in text-[11px] text-primary/60 font-mono"
            >
              {ICONS.find((i) => i.id === hoveredIcon)?.desc} · animated SVG · currentColor
            </p>
          )}
      </div>

      <p className="text-[11px] text-muted-foreground/40 font-mono text-center">
        {mode === 'lucide'
          ? ic.lucide_footer
          : ic.personas_footer}
      </p>
    </div>
  );
}
