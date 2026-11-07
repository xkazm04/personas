import { useId, useRef, type KeyboardEvent } from 'react';
import { Rows2, AlignJustify } from 'lucide-react';
import { motion } from 'framer-motion';
import { DENSITY_VALUES, densityChoiceOf, type Density } from '@/lib/density';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Tooltip } from './Tooltip';

interface DensityToggleProps {
  density: Density;
  onChange: (d: Density) => void;
  /** Suffix added to layoutId to avoid collisions when multiple toggles render. */
  scopeId?: string;
  /** Show the choice labels beside the glyphs (onboarding). Default: glyph-only with a tooltip. */
  showLabels?: boolean;
}

/**
 * @catalog DensityToggle - a per-list two-choice row density picker (Normal and Comfortable); the app itself has one density since 2026-11-07.
 *
 * Standalone radiogroup with arrow-key navigation; the selected cell is surface-2 with a 2px primary
 * foot, animated via Framer's shared layout transitions. Labels are settings.appearance strings.
 */
export function DensityToggle({ density, onChange, scopeId, showLabels = false }: DensityToggleProps) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const autoId = useId();
  const layoutId = `density-toggle-pill-${scopeId ?? autoId}`;
  const groupRef = useRef<HTMLDivElement>(null);
  const current = densityChoiceOf(density);
  const s = t.settings.appearance;

  const labels: Partial<Record<Density, string>> = {
    compact: s.density_console_label,
    comfortable: s.density_comfortable_label,
  };
  const icons: Partial<Record<Density, typeof Rows2>> = { compact: AlignJustify, comfortable: Rows2 };
  const options = DENSITY_VALUES.map((value) => ({ value, label: labels[value] ?? value, Icon: icons[value] ?? Rows2 }));

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = DENSITY_VALUES.indexOf(current);
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (idx + 1) % DENSITY_VALUES.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (idx - 1 + DENSITY_VALUES.length) % DENSITY_VALUES.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = DENSITY_VALUES.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    const nextValue = DENSITY_VALUES[next]!;
    onChange(nextValue);
    const target = groupRef.current?.querySelector<HTMLElement>(`[data-value="${nextValue}"]`);
    target?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={t.shared.density_toggle_aria}
      onKeyDown={handleKeyDown}
      className="inline-flex items-stretch rounded-input border border-hair-2 bg-surface-1 overflow-hidden flex-shrink-0"
    >
      {options.map(({ value, label, Icon }, index) => {
        const isActive = current === value;
        const cell = (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            data-value={value}
            onClick={() => onChange(value)}
            className={`relative flex items-center gap-1.5 ${showLabels ? 'px-3 py-1.5 typo-label' : 'p-1.5'} transition-colors focus-ring ${
              index > 0 ? 'border-l border-hair-2' : ''
            } ${isActive ? 'text-ink-1' : 'text-ink-2 hover:text-ink-1 hover:bg-surface-2'}`}
            aria-label={label}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 bg-surface-2 shadow-[inset_0_-2px_0_var(--primary)]"
                style={{ zIndex: 0 }}
                transition={
                  shouldAnimate
                    ? { type: 'spring', stiffness: 400, damping: 30 }
                    : { duration: 0 }
                }
              />
            )}
            <Icon className="relative z-10 w-3.5 h-3.5" />
            {showLabels && <span className="relative z-10">{label}</span>}
          </button>
        );
        return showLabels ? cell : <Tooltip key={value} content={label}>{cell}</Tooltip>;
      })}
    </div>
  );
}
