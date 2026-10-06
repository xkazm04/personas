import { useCallback, useEffect, useRef, useState } from 'react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { SHORTCUTS_OPEN_EVENT } from '@/lib/keyboard/shortcutRegistry';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useTourStore } from '@/stores/tourStore';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import { getActiveTourSteps } from '@/stores/slices/system/tourSlice';
import { prefetchNotepadHost } from '@/features/notepad/notepadHostChunk';
import { beginNotepadOpen } from '@/features/notepad/notepadTiming';
import { SIDEBAR_TOGGLE_EVENT } from '../footerConstants';

// PROTOTYPE (footer variants): the behaviour of every footer control the
// variants redraw, lifted out of the per-icon components so three different
// drawings share one set of semantics. Each hook mirrors its source file in
// ../icons/ (or notepad/) line for line; only the markup moved.

export function useSidebarCollapse() {
  const read = () => { try { return localStorage.getItem('sidebar-collapsed') === '1'; } catch { return false; } };
  const [collapsed, setCollapsed] = useState(read);
  useEffect(() => {
    const handler = () => {
      try { setCollapsed(localStorage.getItem('sidebar-collapsed') === '1'); }
      catch (err) { silentCatch('footer/variants/useSidebarCollapse')(err); }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);
  const toggle = useCallback(() => {
    window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
    setCollapsed((c) => !c);
  }, []);
  return { collapsed, toggle };
}

export function useShortcutMode() {
  const active = useSystemStore((s) => s.keyboardNavActive);
  const setActive = useSystemStore((s) => s.setKeyboardNavActive);
  const toggle = useCallback(() => setActive(!active), [active, setActive]);
  const openSheet = useCallback((e: { preventDefault: () => void }) => {
    e.preventDefault();
    window.dispatchEvent(new CustomEvent(SHORTCUTS_OPEN_EVENT));
  }, []);
  return { active, toggle, openSheet };
}

export function useNotepadToggle() {
  const open = useSystemStore((s) => s.notepadOpen);
  const setOpen = useSystemStore((s) => s.notepadSetOpen);
  const toggle = useCallback(() => {
    if (!open) beginNotepadOpen();
    setOpen(!open);
  }, [open, setOpen]);
  return { open, toggle, prefetch: prefetchNotepadHost };
}

export function useActiveTheme() {
  const themeId = useThemeStore((s) => s.themeId);
  const theme = THEMES.find((t) => t.id === themeId);
  return { themeId, label: theme?.label ?? 'Default', swatch: theme?.primaryColor ?? '#3b82f6' };
}

/** Open/close + click-outside for an upward popover anchored to a control. */
export function usePopover<T extends HTMLElement = HTMLDivElement>() {
  const [open, setOpen] = useState(false);
  const ref = useRef<T>(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);
  return { open, setOpen, close, ref };
}

/** Resume-tour state; `null` when there is nothing to resume. */
export function useTourResume() {
  const tourActive = useTourStore((s) => s.tourActive);
  const tourDismissed = useTourStore((s) => s.tourDismissed);
  const tourCompleted = useTourStore((s) => s.tourCompleted);
  const tourId = useTourStore((s) => s.tourActiveTourId);
  const stepCompleted = useTourStore((s) => s.tourStepCompleted);
  const resume = useCallback(() => {
    useTourStore.getState().startTour(tourId);
    useTourStore.setState({ tourDismissed: false, tourResumePending: true });
  }, [tourId]);
  const steps = getActiveTourSteps(tourId);
  const total = steps.length;
  const done = steps.filter((s) => stepCompleted[s.id]).length;
  const show = !tourActive && !tourCompleted && tourDismissed && done > 0 && done < total;
  return show ? { done, total, resume } : null;
}

/** Onboarding resume/replay state; `null` while onboarding has nothing to offer. */
export function useOnboardingReplay() {
  const active = useSystemStore((s) => s.onboardingActive);
  const completed = useSystemStore((s) => s.onboardingCompleted);
  const dismissedAtStep = useSystemStore((s) => s.onboardingDismissedAtStep);
  const canResume = !completed && dismissedAtStep != null;
  const run = useCallback(() => {
    if (canResume) useSystemStore.getState().resumeOnboarding();
    else useSystemStore.getState().reopenOnboarding();
  }, [canResume]);
  const show = !active && (canResume || completed);
  return show ? { canResume, run } : null;
}

/**
 * Publish the bar's height as `--desktop-footer-h` so the page reserves the
 * same space the bar takes (PersonasPage's bottom padding reads it).
 */
export function useFooterHeight(px: number) {
  useEffect(() => {
    document.documentElement.style.setProperty('--desktop-footer-h', `${px}px`);
  }, [px]);
}
