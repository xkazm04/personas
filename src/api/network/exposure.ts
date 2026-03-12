import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types
// ============================================================================

export interface ExposedResource {
  id: string;
  resource_type: string;
  resource_id: string;
  display_name: string;
  description: string | null;
  fields_exposed: string;
  access_level: string;
  requires_auth: boolean;
  tags: string;
  created_at: string;
  expires_at: string | null;
}

export interface CreateExposedResourceInput {
  resource_type: string;
  resource_id: string;
  display_name: string;
  description?: string | null;
  fields_exposed: string[];
  access_level: string;
  requires_auth: boolean;
  tags: string[];
  expires_at?: string | null;
}

export interface UpdateExposedResourceInput {
  display_name?: string | null;
  description?: string | null;
  fields_exposed?: string[] | null;
  access_level?: string | null;
  requires_auth?: boolean | null;
  tags?: string[] | null;
  expires_at?: string | null;
}

export interface ExposureManifest {
  version: number;
  owner_peer_id: string;
  owner_display_name: string;
  updated_at: string;
  resources: ExposedResource[];
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

export const getExposedResource = (id: string) =>
  invoke<ExposedResource>("get_exposed_resource", { id });

export const createExposedResource = (input: CreateExposedResourceInput) =>
  invoke<ExposedResource>("create_exposed_resource", { input });

export const updateExposedResource = (id: string, input: UpdateExposedResourceInput) =>
  invoke<ExposedResource>("update_exposed_resource", { id, input });

export const deleteExposedResource = (id: string) =>
  invoke<boolean>("delete_exposed_resource", { id });

// ============================================================================
// Manifest
// ============================================================================

export const getExposureManifest = () =>
  invoke<ExposureManifest>("get_exposure_manifest");

// ============================================================================
// Provenance
// ============================================================================

export const listProvenance = () =>
  invoke<ResourceProvenance[]>("list_provenance");

export const getResourceProvenance = (resourceType: string, resourceId: string) =>
  invoke<ResourceProvenance | null>("get_resource_provenance", { resourceType, resourceId });
