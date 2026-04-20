/**
 * Grouping key for tools that do NOT require a credential type. Tools are
 * grouped in the selector by `requires_credential_type`; tools without one
 * share this sentinel bucket and render under a "General" header.
 *
 * ## Invariants
 *
 * 1. No real connector `name` may equal [`GENERAL_GROUP_KEY`]. The leading
 *    `__` marks this as a reserved sentinel — connector registration should
 *    reject names matching this string.
 * 2. Use [`isGeneralGroup`] / [`toGroupKey`] rather than the raw literal at
 *    every call-site so a future rename is a single-file change.
 */
export const GENERAL_GROUP_KEY = "__general__" as const;

export type GeneralGroupKey = typeof GENERAL_GROUP_KEY;

/** Discriminated key: a real connector name OR the sentinel. */
export type ConnectorGroupKey = GeneralGroupKey | (string & { readonly __connectorBrand?: never });

/** Narrow a group key to the sentinel. */
export function isGeneralGroup(key: string): key is GeneralGroupKey {
  return key === GENERAL_GROUP_KEY;
}

/**
 * Resolve a tool's `requires_credential_type` to a group key, collapsing
 * missing/empty values into [`GENERAL_GROUP_KEY`]. Throws in dev if a real
 * connector name collides with the sentinel.
 */
export function toGroupKey(requiresCredentialType: string | null | undefined): ConnectorGroupKey {
  if (!requiresCredentialType) return GENERAL_GROUP_KEY;
  if (requiresCredentialType === GENERAL_GROUP_KEY && import.meta.env?.DEV) {
    throw new Error(
      `Connector name collides with reserved sentinel ${GENERAL_GROUP_KEY}. Rename the connector.`,
    );
  }
  return requiresCredentialType;
}
