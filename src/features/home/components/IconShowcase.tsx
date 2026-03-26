import { useState } from 'react';
import { ICON_STYLES } from './iconStyles';
import { ICONS, type IconMode } from './iconData';
import { Button } from '@/features/shared/components/buttons';

export default function IconShowcase() {
  const [mode, setMode] = useState<IconMode>('custom');
  const [hoveredIcon, setHoveredIcon] = useState<string | null>(null);

  return (
    <div className="space-y-6 w-full max-w-xl mx-auto">
      {/* Inject animation styles */}
      <style>{ICON_STYLES}</style>

      {/* Switcher */}
      <div className="flex items-center justify-center gap-2">
        <div className="flex bg-secondary/40 p-1 rounded-lg border border-border/50">
          <Button
            variant={mode === 'lucide' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setMode('lucide')}
            className={mode === 'lucide' ? 'shadow-sm' : ''}
          >
            Lucide (Library)
          </Button>
          <Button
            variant={mode === 'custom' ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => setMode('custom')}
            className={mode === 'custom' ? 'shadow-sm' : ''}
          >
            Personas (Animated)
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
              <div className={`relative w-11 h-11 p-2 rounded-xl border transition-all duration-300 cursor-default ${
                hoveredIcon === icon.id
                  ? 'border-primary/40 bg-primary/10 shadow-lg shadow-primary/10 scale-110'
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
          ? 'lucide-react · generic icon library · static'
          : '9 custom icons · neural/circuit motifs · CSS-animated · theme-adaptive'}
      </p>
    </div>
  );
}
