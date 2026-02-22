import { X } from 'lucide-react';

const COLOR_PRESETS = [
  '#8b5cf6', // violet
  '#6366f1', // indigo
  '#3b82f6', // blue
  '#06b6d4', // cyan
  '#10b981', // emerald
  '#f59e0b', // amber
  '#f97316', // orange
  '#ef4444', // red
  '#ec4899', // pink
  '#a855f7', // purple
];

const SIZE_STYLES = {
  sm: { swatch: 'w-7 h-7', nativeInput: 'w-7 h-7', gap: 'gap-1.5' },
  md: { swatch: 'w-8 h-8', nativeInput: 'w-8 h-8', gap: 'gap-2' },
};

interface ColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  size?: 'sm' | 'md';
}

export function ColorPicker({ value, onChange, size = 'md' }: ColorPickerProps) {
  const s = SIZE_STYLES[size];

  return (
    <div className="space-y-2">
      {/* Preset palette */}
      <div className={`flex flex-wrap ${s.gap}`}>
        {COLOR_PRESETS.map((color) => {
          const isSelected = value.toLowerCase() === color.toLowerCase();
          return (
            <button
              key={color}
              type="button"
              onClick={() => onChange(color)}
              className={`${s.swatch} rounded-lg border transition-all ${
                isSelected
                  ? 'border-foreground/50 ring-2 ring-primary/30 scale-110'
                  : 'border-primary/15 hover:border-primary/30 hover:scale-105'
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          );
        })}
      </div>

      {/* Native color input + hex text */}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || '#8b5cf6'}
          onChange={(e) => onChange(e.target.value)}
          className={`${s.nativeInput} rounded-lg cursor-pointer border border-primary/15 bg-transparent`}
        />
        <input
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value.trim() || '#8b5cf6')}
          placeholder="#8b5cf6"
          className="w-28 px-2.5 py-1.5 bg-background/50 border border-primary/15 rounded-lg text-sm font-mono text-foreground placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40 transition-all"
        />
        {value && value !== '#8b5cf6' && (
          <button
            type="button"
            onClick={() => onChange('#8b5cf6')}
            className="p-1.5 rounded-lg border border-dashed border-primary/20 text-muted-foreground/80 hover:text-muted-foreground hover:border-primary/30 transition-all"
            title="Reset to default"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
