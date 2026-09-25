// Knowledge registries API — wrappers over the `dev_tools_registry_*` Tauri
// commands.
//
// A registry is a REPO (an ai-registry checkout) that one or more workspaces
// hold. The wiring lived in `localStorage` until migration e48 promoted it to
// SQLite, which is what lets Rust answer Curator's eligibility, run her loop
// and dispatch into the checkout at all.
//
// The read is ONE command on purpose: the client keeps the whole wiring in
// memory and derives "which registry does this workspace hold" / "who else
// holds it" from it, exactly as it did from the blob.
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { DevRegistry } from "@/lib/bindings/DevRegistry";
import type { DevRegistryInput } from "@/lib/bindings/DevRegistryInput";
import type { RegistryLinkSnapshot } from "@/lib/bindings/RegistryLinkSnapshot";
import type { WorkspaceRegistryLink } from "@/lib/bindings/WorkspaceRegistryLink";

/** Every registry, every workspace's hold, and the derived knowledge root. */
export async function registrySnapshot(): Promise<RegistryLinkSnapshot> {
  return invoke<RegistryLinkSnapshot>("dev_tools_registry_snapshot", {});
}

/**
 * Write a registry — insert or full update.
 *
 * Deliberately not a field-wise patch: the client holds the whole row and
 * every mutation it makes is a merge followed by a write, so a partial door
 * would be a second way to say the same thing with its own rules about which
 * absent field means "leave alone".
 */
export async function upsertRegistry(registry: DevRegistryInput): Promise<DevRegistry> {
  return invoke<DevRegistry>("dev_tools_registry_upsert", { registry });
}

/** Give a workspace a registry to hold, replacing whatever it held. */
export async function linkRegistryToWorkspace(
  workspaceId: string,
  registryId: string,
): Promise<DevRegistry> {
  return invoke<DevRegistry>("dev_tools_registry_link", { workspaceId, registryId });
}

/**
 * Detach a workspace. `false` means it held nothing. The registry survives
 * while any other workspace holds it, and goes with the last one.
 */
export async function unlinkRegistryFromWorkspace(workspaceId: string): Promise<boolean> {
  return invoke<boolean>("dev_tools_registry_unlink", { workspaceId });
}

/** One-time adoption of the browser blob. Idempotent; lands what it can. */
export async function importRegistryLinks(
  registries: DevRegistryInput[],
  links: WorkspaceRegistryLink[],
): Promise<RegistryLinkSnapshot> {
  return invoke<RegistryLinkSnapshot>("dev_tools_registry_import", { registries, links });
}
