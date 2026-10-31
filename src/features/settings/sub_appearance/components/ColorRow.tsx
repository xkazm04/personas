import { useState, useRef, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { X } from 'lucide-react';
import { ColorPicker } from '@/features/shared/components/forms/ColorPicker';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';

// The shared ColorPicker commits a 3-digit hex ("#abc"), but the theme derivation and the
// contrast math (deriveCustomTheme / contrastRatio hexToRgb) only parse six digits and turn a
// short hex into "#NaNNaNNaN". Every custom-theme colour passes through this row, so expand here.
const SHORT_HEX = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
function toSixDigitHex(color: string): string {
  const m = SHORT_HEX.exec(color);
  return m ? `#${m[1]}${m[1]}${m[2]}${m[2]}${m[3]}${m[3]}` : color;
}

// ---------------------------------------------------------------------------
// Inline popup color picker — compact swatch that opens palette on click
// ---------------------------------------------------------------------------

export function ColorRow({
  label,
  value,
  derivedValue,
  onChange,
}: {
  label: string;
  value: string | null;
  derivedValue: string | undefined;
  onChange: (color: string | null) => void;
}) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Closing unmounts whatever inside the popup holds focus (the hex field, a preset), which would
  // drop focus to <body>; hand it back to the swatch button that opened the popup.
  const close = useCallback(() => {
    if (ref.current?.contains(document.activeElement)) triggerRef.current?.focus();
    setOpen(false);
  }, []);
  useClickOutside(ref, open, close);

  const displayValue = value ?? derivedValue ?? '#888888';
  const isOverridden = value !== null;

  return (
    <div ref={ref} className="relative flex items-center gap-3 py-1.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        className={`w-7 h-7 rounded-card border flex-shrink-0 transition-all cursor-pointer ${
          open
            ? 'border-primary/40 ring-2 ring-primary/20'
            : 'border-primary/15 hover:border-primary/30 hover:scale-105'
        }`}
        style={{ backgroundColor: displayValue }}
        title={tx(t.settings.appearance.color_pick_title, { label })}
        aria-expanded={open}
      />
      <span className="typo-caption text-foreground w-24 flex-shrink-0">{label}</span>
      <span className="typo-code flex-1 min-w-0 truncate text-foreground">
        {displayValue}
      </span>
      {isOverridden && (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="p-1 rounded-input text-foreground hover:text-muted-foreground/80 hover:bg-primary/5 transition-colors flex-shrink-0"
          title={t.settings.appearance.reset_to_auto}
        >
          <X className="w-3 h-3" />
        </button>
      )}
      {!isOverridden && (
        <span className="text-[10px] text-foreground flex-shrink-0">{t.settings.appearance.color_auto}</span>
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            role="region"
            aria-label={tx(t.settings.appearance.color_picker_aria, { label })}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12, ease: 'easeOut' }}
            style={{ transformOrigin: 'top left' }}
            className="absolute top-full mt-1 left-0 glass-sm rounded-modal shadow-elevation-3 z-50 p-3 min-w-[280px]"
          >
            <ColorPicker
              value={displayValue}
              onChange={(c) => onChange(toSixDigitHex(c))}
              size="sm"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
