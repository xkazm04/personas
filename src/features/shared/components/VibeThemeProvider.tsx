import { useEffect, useRef, type ReactNode } from 'react';
import { usePersonaVibe } from '@/hooks/theming/usePersonaVibe';
import type { VibeTheme } from '@/lib/theming/vibeThemes';

/**
 * Applies persona-derived "vibe" CSS custom properties to a wrapper element.
 *
 * The vibe layer overlays ambient glow, border tint, and animation pacing
 * on top of the base theme without replacing any existing colours.
 *
 * Place this high in the component tree (e.g. inside App.tsx) so all
 * child components inherit the CSS variables.
 */
export default function VibeThemeProvider({ children }: { children: ReactNode }) {
  const { vibeId, vibe } = usePersonaVibe();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    applyVibeVars(el, vibe);

    if (vibeId === 'default') {
      el.removeAttribute('data-vibe');
    } else {
      el.setAttribute('data-vibe', vibeId);
    }
  }, [vibeId, vibe]);

  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}

function applyVibeVars(el: HTMLElement, vibe: VibeTheme) {
  el.style.setProperty('--vibe-glow', vibe.glowColor);
  el.style.setProperty('--vibe-glow-alt', vibe.glowColorAlt);
  el.style.setProperty('--vibe-bg-tint', vibe.bgTint);
  el.style.setProperty('--vibe-anim-scale', String(vibe.animationScale));
  el.style.setProperty('--vibe-border-intensity', String(vibe.borderIntensity));
}
