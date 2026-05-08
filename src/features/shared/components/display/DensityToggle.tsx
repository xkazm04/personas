import { useId, useRef, type KeyboardEvent } from 'react';
import { Rows3, Rows2, AlignJustify } from 'lucide-react';
import { motion } from 'framer-motion';
import { DENSITY_VALUES, type Density } from '@/lib/density';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

interface DensityToggleProps {
  density: Density;
  onChange: (d: Density) => void;
  /** Suffix added to layoutId to avoid collisions when multiple toggles render. */
  scopeId?: string;
}

/**
 * Three-state row-density picker (cozy / comfortable / compact).
 *
 * Standalone radiogroup with arrow-key navigation; the active pill is
 * animated via Framer's shared layout transitions.
 */
export function DensityToggle({ density, onChange, scopeId }: DensityToggleProps) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const autoId = useId();
  const layoutId = `density-toggle-pill-${scopeId ?? autoId}`;
  const groupRef = useRef<HTMLDivElement>(null);

  const options: Array<{ value: Density; label: string; Icon: typeof Rows3 }> = [
    { value: 'cozy', label: t.shared.density_cozy, Icon: Rows3 },
    { value: 'comfortable', label: t.shared.density_comfortable, Icon: Rows2 },
    { value: 'compact', label: t.shared.density_compact, Icon: AlignJustify },
  ];

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const idx = DENSITY_VALUES.indexOf(density);
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
      className="inline-flex items-center rounded-card border border-primary/15 bg-secondary/30 overflow-hidden flex-shrink-0"
    >
      {options.map(({ value, label, Icon }) => {
        const isActive = density === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            data-value={value}
            onClick={() => onChange(value)}
            className={`relative p-1.5 transition-colors ${
              isActive
                ? 'text-primary'
                : 'text-foreground hover:text-foreground/95 hover:bg-secondary/40'
            }`}
            title={label}
            aria-label={label}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 bg-primary/15"
                style={{ zIndex: 0 }}
                transition={
                  shouldAnimate
                    ? { type: 'spring', stiffness: 400, damping: 30 }
                    : { duration: 0 }
                }
              />
            )}
            <Icon className="relative z-10 w-3.5 h-3.5" />
          </button>
        );
      })}
    </div>
  );
}
