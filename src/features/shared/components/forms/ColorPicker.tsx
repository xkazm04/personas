import { useEffect, useId, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

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

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

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
  const { t } = useTranslation();
  const s = SIZE_STYLES[size];
  const errorId = useId();

  const [hexDraft, setHexDraft] = useState(value ?? '');
  const [invalid, setInvalid] = useState(false);

  // Sync the draft when the upstream value changes from another source
  // (preset swatch, native color input, reset button).
  useEffect(() => {
    if (!value) return;
    if (hexDraft.trim().toLowerCase() !== value.toLowerCase()) {
      setHexDraft(value);
      setInvalid(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleHexInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    setHexDraft(raw);
    const trimmed = raw.trim();
    if (trimmed === '') {
      setInvalid(false);
      return;
    }
    if (HEX_RE.test(trimmed)) {
      setInvalid(false);
      onChange(trimmed);
    } else {
      setInvalid(true);
    }
  };

  const handleHexBlur = () => {
    const trimmed = hexDraft.trim();
    if (trimmed === '' || !HEX_RE.test(trimmed)) {
      // Revert to upstream value on invalid blur so state stays consistent
      setHexDraft(value ?? '');
      setInvalid(false);
    }
  };

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
          value={HEX_RE.test(value) ? value : '#8b5cf6'}
          onChange={(e) => onChange(e.target.value)}
          className={`${s.nativeInput} rounded-lg cursor-pointer border border-primary/15 bg-transparent`}
        />
        <input
          type="text"
          value={hexDraft}
          onChange={handleHexInput}
          onBlur={handleHexBlur}
          placeholder={t.shared.forms_extra.color_hex_placeholder}
          aria-invalid={invalid || undefined}
          aria-errormessage={invalid ? errorId : undefined}
          spellCheck={false}
          className={`w-28 px-2.5 py-1.5 bg-background/50 border rounded-xl typo-code text-foreground placeholder-muted-foreground/30 focus-ring transition-colors ${
            invalid
              ? 'border-status-error/70 ring-1 ring-status-error/30'
              : 'border-primary/15'
          }`}
        />
        {value && value !== '#8b5cf6' && (
          <button
            type="button"
            onClick={() => onChange('#8b5cf6')}
            className="p-1.5 rounded-lg border border-dashed border-primary/20 text-foreground hover:text-foreground hover:border-primary/30 transition-all"
            title={t.shared.forms_extra.reset_to_default}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="text-[10px] text-status-error/80 font-medium">
          {t.shared.forms_extra.invalid_hex}
        </p>
      )}
    </div>
  );
}
