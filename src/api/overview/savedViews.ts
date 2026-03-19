import { invoke } from '@tauri-apps/api/core';
import type { SavedView } from "@/lib/bindings/SavedView";
import type { CreateSavedViewInput } from "@/lib/bindings/CreateSavedViewInput";

export type { SavedView } from "@/lib/bindings/SavedView";
export type { CreateSavedViewInput } from "@/lib/bindings/CreateSavedViewInput";

export async function createSavedView(input: CreateSavedViewInput): Promise<SavedView> {
  return invoke('create_saved_view', { input });
}

export async function listSavedViews(): Promise<SavedView[]> {
  return invoke('list_saved_views');
}

export async function listSavedViewsByType(viewType: string): Promise<SavedView[]> {
  return invoke('list_saved_views_by_type', { viewType });
}

export async function deleteSavedView(id: string): Promise<void> {
  return invoke('delete_saved_view', { id });
}
