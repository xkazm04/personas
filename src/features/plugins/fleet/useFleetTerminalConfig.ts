import { useEffect } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import {
  configureFleetTerminals,
  appIsLightTheme,
  type FleetResolvedTheme,
} from './fleetTerminalManager';

/**
 * Bridge the persisted Fleet terminal settings (font size, copy-on-select,
 * theme) into the terminal manager, and keep them live.
 *
 * Mount this once from the Fleet grid page. It:
 *   - pushes the current store config into every live terminal whenever it
 *     changes, and
 *   - when the theme is `auto`, re-resolves dark/light from the app's
 *     `data-theme` attribute and re-applies on theme switches (via a
 *     MutationObserver) so the terminal tracks the rest of the UI.
 */
export function useFleetTerminalConfig(): void {
  const fontSize = useSystemStore((s) => s.fleetTerminalFontSize);
  const copyOnSelect = useSystemStore((s) => s.fleetTerminalCopyOnSelect);
  const theme = useSystemStore((s) => s.fleetTerminalTheme);

  useEffect(() => {
    const resolve = (): FleetResolvedTheme =>
      theme === 'auto' ? (appIsLightTheme() ? 'light' : 'dark') : theme;

    configureFleetTerminals({ fontSize, copyOnSelect, theme: resolve() });

    // In auto mode, follow the app's data-theme flips.
    if (theme !== 'auto') return;
    const obs = new MutationObserver(() => {
      configureFleetTerminals({ theme: resolve() });
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    return () => obs.disconnect();
  }, [fontSize, copyOnSelect, theme]);
}
