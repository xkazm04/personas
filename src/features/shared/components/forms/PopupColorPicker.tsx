import { useState, useRef, useCallback } from 'react';
import { Palette } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { ColorPicker } from '@/features/shared/components/forms/ColorPicker';

interface PopupColorPickerProps {
  value: string;
  onChange: (color: string) => void;
  size?: 'sm' | 'md';
}

export function PopupColorPicker({ value, onChange, size = 'sm' }: PopupColorPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(containerRef, open, close);

  const handlePresetChange = (color: string) => {
    onChange(color);
    // Close on preset click, stay open for custom hex
    if (color.startsWith('#') && color.length === 7) {
      setOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-primary/15 hover:border-primary/30 hover:scale-105'
        }`}
        title="Choose color"
      >
        {value ? (
          <div
            className="w-6 h-6 rounded-lg"
            style={{ backgroundColor: value }}
          />
        ) : (
          <Palette className="w-4 h-4 text-foreground" />
        )}
      </button>

      {open && (
          <div
            className="animate-fade-slide-in absolute top-full mt-1 left-0 bg-background border border-primary/20 rounded-xl shadow-elevation-3 z-50 p-3 min-w-[280px]"
          >
            <ColorPicker
              value={value}
              onChange={handlePresetChange}
              size={size}
            />
          </div>
        )}
    </div>
  );
}
