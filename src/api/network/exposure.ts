import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Enums
// ============================================================================

export type AccessLevel = "read" | "execute" | "fork";
export type ResourceType = "persona" | "template" | "execution_result" | "knowledge" | "connector";

// ============================================================================
// Types
// ============================================================================

export interface ExposedResource {
  id: string;
  resource_type: ResourceType;
  resource_id: string;
  display_name: string;
  description: string | null;
  fields_exposed: string;
  access_level: AccessLevel;
  requires_auth: boolean;
  tags: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreateExposedResourceInput {
  resource_type: ResourceType;
  resource_id: string;
  display_name: string;
  description?: string | null;
  fields_exposed: string[];
  access_level: AccessLevel;
  requires_auth: boolean;
  tags: string[];
  expires_at?: string | null;
}

export interface ResourceProvenance {
  resource_type: string;
  resource_id: string;
  source_peer_id: string;
  source_display_name: string | null;
  imported_at: string;
  bundle_hash: string | null;
  signature_verified: boolean;
}

// ============================================================================
// Exposed Resources
// ============================================================================

export const listExposedResources = () =>
  invoke<ExposedResource[]>("list_exposed_resources");

export const createExposedResource = (input: CreateExposedResourceInput) =>
  invoke<ExposedResource>("create_exposed_resource", { input });

export const deleteExposedResource = (id: string) =>
  invoke<boolean>("delete_exposed_resource", { id });

// ============================================================================
// Provenance
// ============================================================================

export const listProvenance = () =>
  invoke<ResourceProvenance[]>("list_provenance");
