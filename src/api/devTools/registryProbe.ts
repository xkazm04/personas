// Registry probe API - wrapper over the dev_tools_registry_probe Tauri command.
//
// The Rust side inspects a local folder and reports whether it is a registry
// working copy (registry.yaml, catalog.json, git metadata). Nothing is persisted.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { RegistryProbe } from "@/lib/bindings/RegistryProbe";

/** Ask whether a local folder is a registry working copy. A non-registry
 *  folder resolves with `valid: false` + `reason` — it never rejects for a
 *  mere wrong folder, so the picker can show the reason inline. */
export async function probeRegistry(path: string): Promise<RegistryProbe> {
  return invoke<RegistryProbe>("dev_tools_registry_probe", { path });
}
