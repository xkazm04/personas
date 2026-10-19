/** persona-core — the temperament configurator under the build intent.
 *  Public surface: the badge (dimension-row chip) and PersonaCoreEntry, its
 *  compose-surface door, the chrome-free body (PersonaCoreBody) the host's own
 *  layer renders, the close analytics, the state hook, and the PersonaCore
 *  type. Internals (catalog, leaf components, orchestrator) stay private to
 *  the folder. */
export { PersonaCoreBadge } from "./PersonaCoreBadge";
export { PersonaCoreEntry } from "./PersonaCoreEntry";
export { PersonaCoreBody } from "./PersonaCoreBody";
export { recordPersonaCoreClose, personaCoreAccent } from "./coreAnalytics";
export { usePersonaCore } from "./usePersonaCore";
export type { PersonaCore } from "./types";
export { composeManifestSeed, extractDesignSeed, narrowManifestSeed } from "./composeCoreProfile";
export type { PersonaCoreLaunchSnapshot, ManifestSeed } from "./composeCoreProfile";
