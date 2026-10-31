/**
 * Personas against a RUNNING bp (spark roadmap S6): the Monitor's Blueprint or Morning tab with the drawing sheet host,
 * on the app's real code paths (the window's follower, liveActions, LensSheetHost, LiveBlueprint, MorningDeck with its
 * live doors). Only the Rust layer is stood in for: every `invoke` goes to `window.__bpLiveInvoke`, which the driver
 * (bpLiveDrive.mjs) exposes from Node and answers the way Personas' Rust does - bp's loopback HTTP with no Origin
 * (bp_link), lens-scan's store.mjs for a decision (lens_scan_decide), the store snapshot Rust dumped (lens_scan_snapshot).
 * It never reaches a real store: the driver serves bp's demo products only.
 *
 *   decision-center/bp-live   --query "view=blueprint"   the Blueprint tab (the picker) + the sheet host
 *                             --query "view=morning"     the Morning tab + the sheet host
 */
import type { ReactNode } from 'react';
import type { HarnessModule } from './registry';

declare global { interface Window { __bpLiveInvoke?: (cmd: string, args: unknown) => Promise<unknown> } }

async function keyboardProvider() {
  const { AppKeyboardProvider } = await import('@/lib/keyboard/AppKeyboardProvider');
  return (children: ReactNode) => <AppKeyboardProvider>{children}</AppKeyboardProvider>;
}

export const BP_LIVE_MODULES: Record<string, HarnessModule> = {
  'decision-center/bp-live': {
    prepare: async () => {
      const { mockIPC } = await import('@tauri-apps/api/mocks');
      // the driver is the Rust layer: an invoke it does not know rejects, so the page shows it rather than hiding it
      mockIPC((cmd, args) => {
        if (!window.__bpLiveInvoke) throw new Error('no bp-live bridge: run scripts/style/page-harness/bpLiveDrive.mjs');
        return window.__bpLiveInvoke(cmd, args ?? {});
      });
      const { useSystemStore } = await import('@/stores/systemStore');
      useSystemStore.setState({ headerOverlay: 'monitor' });
    },
    load: async () => {
      const [{ BlueprintPicker }, { MorningDeck }, { LensSheetHost }] = await Promise.all([
        import('@/features/decision-center/lens/BlueprintPicker'),
        import('@/features/decision-center/lens/morning/MorningDeck'),
        import('@/features/decision-center/lens/LensSheetHost'),
      ]);
      function BpLivePage() {
        const view = new URLSearchParams(window.location.search).get('view') ?? 'blueprint';
        return (
          <div className="relative flex-1 min-h-0 overflow-y-auto">{/* a block wrapper, as MonitorBody gives the tab */}
            {view === 'morning' ? <MorningDeck /> : <BlueprintPicker />}
            <LensSheetHost />
          </div>
        );
      }
      return { default: BpLivePage };
    },
    providers: keyboardProvider,
  },
};
