/**
 * Home > System Check (`overview/components/health`, kit batch home-3): the panel HomePage
 * mounts in a keep-alive pane for the DEV-only tab `system-check` (HomePage.tsx:98-102), in
 * the same pane class, on the synthetic tapes in `homeSystemCheckTapes.mjs`.
 *
 *   home/system-check          the mixed board: Node missing and installable, a disk warning,
 *                              an ageing key, cloud and account never configured
 *   home/system-check/healthy  every check passes - the board with nothing to do
 *   home/system-check/loading  the six section checks never resolve, so the cold-load ghosts hold
 *
 * The panel mounts one of THREE 2-layer prototypes behind a persisted dev switch
 * (`healthVariant.ts`), so `shoot.mjs --kit board|spine|triage` picks which one a run shoots; the
 * default with no `--kit` is `board`. Each prototype is shot against the mixed board AND against
 * `home/system-check/healthy`, because "what the surface costs when there is nothing to do" is
 * exactly what prototype C bets on.
 *
 * The panel is a static import in HomePage (not lazy), so it mounts with the Home bundle.
 * `CrashLogsSection` is DEV-only inside the panel and the harness runs under Vite dev, so it
 * renders here exactly as the owner sees it.
 */
import type { ComponentType } from 'react';
import { HEALTH_VARIANT_IDS } from '@/features/overview/components/health/healthVariant';
import { safeLocalSet } from '@/lib/safeLocalStorage';
import { useSystemStore } from '@/stores/systemStore';
import type { HarnessModule } from './registry';

/** The six per-section health commands the panel fans out (one independent cycle each). */
const CHECK_COMMANDS = [
  'health_check_local', 'health_check_environment', 'health_check_agents',
  'health_check_cloud', 'health_check_account', 'health_check_subscriptions',
];

/** Holds the given commands' promises open, so the panel stays on its cold-load ghosts. */
function holdCommands(cmds: readonly string[]): void {
  // The harness's mocked internals; the running app never loads this file.
  const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (...a: unknown[]) => unknown } }).__TAURI_INTERNALS__;
  if (!internals) return;
  const original = internals.invoke.bind(internals);
  try {
    internals.invoke = (c: unknown, ...rest: unknown[]) =>
      (typeof c === 'string' && cmds.includes(c) ? new Promise(() => {}) : original(c, ...rest));
  } catch (err) {
    console.warn('[page-harness] could not hold health checks', err);
  }
}

/** `?kit=<id>` picks the prototype through the same persisted key the in-app switch writes. */
function pickVariant(): void {
  const kit = new URLSearchParams(window.location.search).get('kit') ?? '';
  const id = (HEALTH_VARIANT_IDS as readonly string[]).includes(kit) ? kit : 'board';
  safeLocalSet('system-check-variant', id, 'page-harness:health-variant');
}

async function prepareSystemCheck(opts: { hold?: boolean } = {}): Promise<void> {
  pickVariant();
  if (opts.hold) holdCommands(CHECK_COMMANDS);
  useSystemStore.setState({ sidebarSection: 'home', homeTab: 'system-check' });
  // The panel reads the auth store directly; a signed-out profile is what the
  // `account` section's sign-in affordance is drawn for.
  const { useAuthStore } = await import('@/stores/authStore');
  useAuthStore.setState({ isAuthenticated: false, isLoading: false, error: null });
}

function inHomePane(): () => Promise<{ default: ComponentType }> {
  return async () => {
    const { SystemHealthPanel } = await import('@/features/overview/components/health/SystemHealthPanel');
    return {
      default: function SystemCheckHost() {
        // The keep-alive pane HomePage gives an active tab (PANE_CLASS, minus its entrance animation).
        return (
          <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
            <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
              <SystemHealthPanel />
            </div>
          </div>
        );
      },
    };
  };
}

export const HOME_SYSTEM_CHECK_MODULES: Record<string, HarnessModule> = {
  'home/system-check': { load: inHomePane(), prepare: () => prepareSystemCheck() },
  'home/system-check/healthy': { load: inHomePane(), prepare: () => prepareSystemCheck() },
  'home/system-check/loading': { load: inHomePane(), prepare: () => prepareSystemCheck({ hold: true }) },
};
