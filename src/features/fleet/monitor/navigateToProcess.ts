// Navigate to the surface an ActiveProcess points at.
//
// Extracted from MonitorDrawer so the Monitor is not the only place that can
// act on a process's `navigateTo`: Mastermind's island persona list routes
// through the SAME switch, which keeps "click a running persona" landing on one
// destination no matter which surface the click came from. Kept out of
// monitorModel.ts because that module is deliberately store-free.
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { ALL_SIDEBAR_SECTIONS } from '@/lib/navigation/registry';
import { silentCatch } from '@/lib/silentCatch';
import type { DevToolsTab, PluginTab, SidebarSection, TeamsTab } from '@/lib/types/types';
import type { ActiveProcess } from '@/stores/slices/processActivitySlice';

/**
 * The one runtime door. `ProcessNavigateTo.section` is typed `SidebarSection`,
 * but a process can be rehydrated from persisted state written by an older (or
 * newer) build, so the value is verified against the live section registry
 * before it is used. An unrecognised section is a NO-OP that reports — never a
 * navigation to a section that is not the one the process meant.
 */
function isSidebarSection(value: string): value is SidebarSection {
  return (ALL_SIDEBAR_SECTIONS as readonly string[]).includes(value);
}

/**
 * THE ONE DOOR ONTO A DEV TOOLS SURFACE, for callers outside a process's
 * `navigateTo`.
 *
 * Extracted (2026-09-20) rather than copied, when the Activity board's
 * workspace-group menu needed the same three writes to reach Dev Tools →
 * Workspaces. Copying would have opened the tree's 22nd ungated plugin arrival
 * — the condition `ungated-plugin-destination-write` counts, and which
 * `plugin-surface-shell.md` records as having **no compliant form anywhere in
 * this tree**: the plugin's own enable switch is read by the chrome that lists
 * plugins and by nothing that mounts one. This extraction does not fix that (a
 * fix is a gate read every arrival shares, which is that golden path's work,
 * not a column menu's), but it does stop the count growing, and it puts the one
 * place a future gate read belongs behind one name.
 *
 * Re-setting `sidebarSection` to the section you are already on is documented
 * as a no-op for history (`uiSlice.ts` `setSidebarSection`), so the caller
 * inside `navigateToProcess` pays nothing for going through here.
 */
export function openDevToolsTab(tab: DevToolsTab): void {
  const system = useSystemStore.getState();
  system.setSidebarSection('plugins');
  system.setPluginTab('dev-tools' as PluginTab);
  system.setDevToolsTab(tab);
}

/** Navigate to the surface a process points at, then run `dismiss` (close the
 *  Monitor drawer, the island popover, …). No-op when the process declares no
 *  destination — callers should gate their affordance on `navigateTo` too. */
export function navigateToProcess(proc: ActiveProcess, dismiss: () => void) {
  if (!proc.navigateTo) return;
  const { section, tab, personaId, chatSessionId } = proc.navigateTo;
  if (!isSidebarSection(section)) {
    silentCatch('fleet/monitor/navigateToProcess:unknown-section')(
      new Error(`unrecognised sidebar section "${section}" — navigation skipped`),
    );
    return;
  }
  const system = useSystemStore.getState();
  system.setSidebarSection(section);
  if (tab) {
    // Only these three sections own an L2 tab a process can point at. Anything
    // else lands on the section itself rather than being pushed into some
    // other section's tab setter.
    if (section === 'personas') {
      system.setEditorTab(tab as Parameters<typeof system.setEditorTab>[0]);
    } else if (section === 'plugins') {
      openDevToolsTab(tab as DevToolsTab);
    } else if (section === 'teams') {
      system.setTeamsTab(tab as TeamsTab);
    } else {
      silentCatch('fleet/monitor/navigateToProcess:unroutable-tab')(
        new Error(`section "${section}" has no tab router for "${tab}" — section shown without it`),
      );
    }
  }
  if (personaId) {
    useAgentStore.getState().selectPersona(personaId);
    if (chatSessionId && tab === 'chat') {
      void useAgentStore.getState().restoreChatSession(personaId, chatSessionId);
    }
  }
  dismiss();
}
