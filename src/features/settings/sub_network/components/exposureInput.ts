import type { AccessLevel, CreateExposedResourceInput, ResourceType } from '@/api/network/exposure';

/**
 * Build the create payload for a new exposure.
 *
 * `requires_auth` is written `true`: the schema default is 1 (fail closed) and
 * `build_local_manifest` serves only requires_auth=0 rows to any connected LAN
 * peer, whose identity is not cryptographically verified. Opening an exposure
 * to unauthenticated peers must be an explicit operator choice, never the
 * silent result of creating one: only `openToUnauthenticatedPeers === true`
 * (the form's opt-in switch, default off) writes `requires_auth: false`.
 */
export function buildCreateExposureInput(args: {
  resourceType: ResourceType;
  resourceId: string;
  displayName: string;
  accessLevel: AccessLevel;
  tags: string;
  /** Explicit opt-in. Anything but `true` keeps the exposure behind auth. */
  openToUnauthenticatedPeers?: boolean;
}): CreateExposedResourceInput {
  return {
    resource_type: args.resourceType,
    resource_id: args.resourceId,
    display_name: args.displayName,
    fields_exposed: [],
    access_level: args.accessLevel,
    requires_auth: args.openToUnauthenticatedPeers !== true,
    tags: args.tags ? args.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
  };
}
