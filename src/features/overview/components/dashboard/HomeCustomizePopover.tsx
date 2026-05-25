import { memo, useState, useRef, useEffect, useCallback } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

/**
 * Ids of the below-the-fold Home sections that can be toggled. Order here is
 * purely the order they appear in the Customize popover; the page renders them
 * in its own layout order and only consults membership in `homeHiddenSections`.
 * Shared with DashboardHomeMissionControl so the gate and the toggle list can
 * never drift.
 */
export const HOME_SECTION_IDS = ['heatmap', 'instruments', 'memory', 'fleet', 'routines'] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

const SECTION_LABEL: Record<HomeSectionId, (t: Translations) => string> = {
  heatmap: (t) => t.overview.dashboard.section_heatmap,
  instruments: (t) => t.overview.dashboard.section_instruments,
  memory: (t) => t.overview.dashboard.section_memory,
  fleet: (t) => t.overview.dashboard.section_fleet,
  routines: (t) => t.overview.dashboard.section_routines,
};

export const HomeCustomizePopover = memo(function HomeCustomizePopover() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const { hidden, toggleHomeSection, resetHomeSections } = useSystemStore(useShallow((s) => ({
    hidden: s.homeHiddenSections,
    toggleHomeSection: s.toggleHomeSection,
    resetHomeSections: s.resetHomeSections,
  })));

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (
        popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const hiddenCount = hidden.length;
  const onReset = useCallback(() => resetHomeSections(), [resetHomeSections]);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        aria-label={t.overview.dashboard.customize_label}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-interactive border border-primary/15 bg-secondary/40 text-foreground typo-caption hover:bg-secondary/60 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
      >
        <SlidersHorizontal className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">{t.overview.dashboard.customize_label}</span>
        {hiddenCount > 0 && (
          <span className="typo-caption font-mono tabular-nums px-1 rounded-interactive bg-primary/10 text-primary">{hiddenCount}</span>
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-50 min-w-[240px] bg-background/95 backdrop-blur-md border border-primary/20 rounded-modal shadow-elevation-3 p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="typo-caption uppercase tracking-widest text-foreground font-mono">{t.overview.dashboard.customize_title}</span>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={onReset}
                className="typo-caption text-primary/80 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 rounded-interactive px-1"
              >
                {t.overview.dashboard.customize_reset}
              </button>
            )}
          </div>
          <div className="space-y-1">
            {HOME_SECTION_IDS.map((id) => {
              const label = SECTION_LABEL[id](t);
              const visible = !hidden.includes(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 px-1.5 py-1.5 rounded-interactive hover:bg-primary/[0.04]">
                  <span className="typo-body text-foreground truncate">{label}</span>
                  <AccessibleToggle checked={visible} onChange={() => toggleHomeSection(id)} label={label} size="sm" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
});
