import { useId, useRef, type KeyboardEvent } from 'react';
import { LayoutList, AlignJustify, LayoutGrid } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';
import { useMotion } from '@/hooks/utility/interaction/useMotion';

export type Density = 'comfortable' | 'compact' | 'role';

interface DensityToggleProps {
  density: Density;
  onChange: (d: Density) => void;
}

const DENSITY_VALUES: Density[] = ['comfortable', 'compact', 'role'];

export function DensityToggle({ density, onChange }: DensityToggleProps) {
  const { t } = useTranslation();
  const { shouldAnimate } = useMotion();
  const autoId = useId();
  const layoutId = `density-toggle-pill-${autoId}`;
  const groupRef = useRef<HTMLDivElement>(null);

  const options: Array<{ value: Density; label: string; Icon: typeof LayoutList }> = [
    { value: 'comfortable', label: t.templates.search.comfortable_view, Icon: LayoutList },
    { value: 'compact', label: t.templates.search.compact_view, Icon: AlignJustify },
    { value: 'role', label: t.templates.explore.by_role, Icon: LayoutGrid },
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
      aria-label={t.templates.search.density_filter_aria}
      onKeyDown={handleKeyDown}
      className="inline-flex items-center rounded-card border border-primary/15 overflow-hidden flex-shrink-0"
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
                ? 'text-violet-300'
                : 'text-foreground hover:text-muted-foreground/80 hover:bg-secondary/40'
            }`}
            title={label}
            aria-label={label}
          >
            {isActive && (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 bg-violet-500/20"
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
