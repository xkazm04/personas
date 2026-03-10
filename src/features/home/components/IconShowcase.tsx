import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ICON_STYLES } from './iconStyles';
import { ICONS, type IconMode } from './iconData';

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
          <button
            onClick={() => setMode('lucide')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'lucide'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Lucide (Library)
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`px-4 py-1.5 rounded-md text-xs font-medium transition-all ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Personas (Animated)
          </button>
        </div>
      </div>

      {/* Icon grid */}
      <div className="grid grid-cols-9 gap-2">
        <AnimatePresence mode="wait">
          {ICONS.map((icon, i) => (
            <motion.div
              key={`${icon.id}-${mode}`}
              initial={{ scale: 0.7, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.7, opacity: 0, y: -8 }}
              transition={{ delay: i * 0.04, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center gap-1.5"
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
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Hover detail */}
      <div className="h-5 flex items-center justify-center">
        <AnimatePresence mode="wait">
          {hoveredIcon && mode === 'custom' && (
            <motion.p
              key={hoveredIcon}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              className="text-[11px] text-primary/60 font-mono"
            >
              {ICONS.find((i) => i.id === hoveredIcon)?.desc} · animated SVG · currentColor
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <p className="text-[11px] text-muted-foreground/40 font-mono text-center">
        {mode === 'lucide'
          ? 'lucide-react · generic icon library · static'
          : '9 custom icons · neural/circuit motifs · CSS-animated · theme-adaptive'}
      </p>
    </div>
  );
}
