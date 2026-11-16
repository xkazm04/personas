import { memo, useState, useRef, useEffect, useCallback } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { SlidersHorizontal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useSystemStore } from '@/stores/systemStore';
import { useAppKeyboard, OVERLAY_DISMISS_PRIORITY } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';

/**
 * Ids of the below-the-fold Home sections that can be toggled. Order here is
 * purely the order they appear in the Customize popover; the page renders them
 * in its own layout order and only consults membership in `homeHiddenSections`.
 * Shared with MissionControlHome so the gate and the toggle list can
 * never drift. ('instruments' was retired with the 2026-08-25 monitoring
 * consolidation — a persisted hidden entry for it is simply ignored.)
 */
export const HOME_SECTION_IDS = ['heatmap', 'memory', 'fleet', 'routines'] as const;
export type HomeSectionId = (typeof HOME_SECTION_IDS)[number];

const SECTION_LABEL: Record<HomeSectionId, (t: Translations) => string> = {
  heatmap: (t) => t.overview.dashboard.section_heatmap,
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

  useAppKeyboard(
    (e) => {
      if (e.key !== 'Escape') return false;
      e.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
      return true;
    },
    { enabled: open, priority: OVERLAY_DISMISS_PRIORITY },
  );

  const hiddenCount = hidden.length;
  const onReset = useCallback(() => resetHomeSections(), [resetHomeSections]);

  return (
    <div className="relative">
      <Button variant="secondary" size="sm" ref={buttonRef} onClick={() => setOpen((p) => !p)} aria-expanded={open} aria-label={t.overview.dashboard.customize_label} icon={<SlidersHorizontal className="w-3.5 h-3.5" />}>
<span className="hidden sm:inline">{t.overview.dashboard.customize_label}</span>
        {hiddenCount > 0 && (
          <span className="typo-data font-mono px-1 rounded-interactive bg-primary/10 text-primary">{hiddenCount}</span>
        )}
</Button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-full right-0 mt-2 z-50 min-w-[240px] bg-background/95 backdrop-blur-md border border-hair rounded-modal shadow-elevation-3 p-3"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="typo-eyebrow">{t.overview.dashboard.customize_title}</span>
            {hiddenCount > 0 && (
              <Button variant="ghost" size="xs" onClick={onReset}>
                {t.overview.dashboard.customize_reset}
              </Button>
            )}
          </div>
          <div className="space-y-1">
            {HOME_SECTION_IDS.map((id) => {
              const label = SECTION_LABEL[id](t);
              const visible = !hidden.includes(id);
              return (
                <div key={id} className="flex items-center justify-between gap-3 px-1.5 py-1.5 rounded-interactive hover:bg-surface-2">
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
