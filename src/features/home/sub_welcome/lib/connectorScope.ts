/**
 * Coarse, DISPLAY-ONLY split of a credential's connector into "built-in/local"
 * vs "external/3rd-party", used only for the Home → Quick-Navigation
 * Connections card chip.
 *
 * The canonical readiness model is the backend `ConnectorClass`
 * (`zero_config | credential | global_probe`) resolved server-side; it is not
 * exposed per-credential on the frontend. The old `BUILTIN_LOCAL_CONNECTORS`
 * allowlists were deliberately retired in the connector-classification
 * redesign, so this is intentionally NOT a readiness gate — it's a small,
 * best-effort label for a dashboard count. A new local connector that isn't
 * matched here simply shows up in the "external" bucket; nothing breaks.
 *
 * Local connectors are the app's own offline capabilities (local messaging /
 * drive, the vector KB, codebase indexing, Obsidian bridge) — identified by a
 * stable name prefix or a known-name set drawn from
 * `scripts/connectors/builtin/*.json`.
 */

const LOCAL_CONNECTOR_NAMES: ReadonlySet<string> = new Set([
  'personas_messages',
  'personas_database',
  'personas_vector_db',
  'local_drive',
  'codebase',
  'codebases',
  'obsidian',
  'obsidian_memory',
  'desktop_obsidian',
  'vectorKnowledgeBase',
]);

/** True when `serviceType` names one of the app's built-in/local connectors. */
export function isLocalConnector(serviceType: string | null | undefined): boolean {
  if (!serviceType) return false;
  if (LOCAL_CONNECTOR_NAMES.has(serviceType)) return true;
  return /^(personas_|local_)/.test(serviceType) || serviceType.includes('obsidian');
}
