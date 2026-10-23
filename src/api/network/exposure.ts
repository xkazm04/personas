import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// ============================================================================
// Types — the ts-rs bindings ARE the contract; these were hand-copied until
// 2026-10-19 and are re-exported so existing imports keep working. The create
// input stays local: its optional fields are looser than the binding's.
// ============================================================================

import type { AccessLevel } from "@/lib/bindings/AccessLevel";
import type { ResourceType } from "@/lib/bindings/ResourceType";
import type { ExposedResource } from "@/lib/bindings/ExposedResource";
import type { ResourceProvenance } from "@/lib/bindings/ResourceProvenance";

export type { AccessLevel, ResourceType, ExposedResource, ResourceProvenance };

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
