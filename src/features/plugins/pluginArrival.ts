// The one door onto a plugin surface, and the only one that asks first.
//
// A plugin carries an enable/disable state the user sets. Until now that state
// was consulted by the chrome that LISTS plugins and by nothing that MOUNTS
// one, so every arrival door in the app was a bypass of the gate the product
// presents (`docs/concepts/golden-paths/plugin-surface-shell.md`, whose census
// rule records that "there is no compliant form of this write anywhere in the
// tree"). This is that form.
//
// `arriveAtPlugin` reads `enabledPlugins` FIRST and refuses when the plugin is
// off, so a caller can never land a person on a surface they have switched
// away. It returns whether the arrival happened, which is what lets a caller
// hide or disable the affordance instead of offering a door into nothing.
import type { DevToolsTab, PluginTab } from '@/lib/types/types';
import { useSystemStore } from '@/stores/systemStore';

/** Is this plugin switched on for this install? The read every arrival owes. */
export function pluginEnabled(plugin: PluginTab): boolean {
  // `browse` is the plugin catalog itself and is never in the enabled set: it
  // is the chrome that turns the others on, so it is always reachable.
  if (plugin === 'browse') return true;
  return useSystemStore.getState().enabledPlugins.has(plugin);
}

/**
 * Land on a plugin surface, or refuse and say so.
 *
 * @returns `true` when the navigation happened. `false` means the plugin is
 *   disabled and NOTHING was written - the caller's own surface is unchanged.
 */
export function arriveAtPlugin(plugin: PluginTab): boolean {
  if (!pluginEnabled(plugin)) return false;
  const sys = useSystemStore.getState();
  sys.setSidebarSection('plugins');
  sys.setPluginTab(plugin);
  return true;
}

/** The Dev Tools plugin plus one of its tabs, through the same gate. */
export function arriveAtDevTools(tab: DevToolsTab): boolean {
  if (!arriveAtPlugin('dev-tools')) return false;
  useSystemStore.getState().setDevToolsTab(tab);
  return true;
}
