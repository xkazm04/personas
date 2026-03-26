import { invokeWithTimeout } from '@/lib/tauriInvoke';
import type { SavedView } from "@/lib/bindings/SavedView";
import type { CreateSavedViewInput } from "@/lib/bindings/CreateSavedViewInput";

export type { SavedView } from "@/lib/bindings/SavedView";
export type { CreateSavedViewInput } from "@/lib/bindings/CreateSavedViewInput";

export async function createSavedView(input: CreateSavedViewInput): Promise<SavedView> {
  return invokeWithTimeout('create_saved_view', { input });
}

export async function listSavedViews(): Promise<SavedView[]> {
  return invokeWithTimeout('list_saved_views');
}

export async function listSavedViewsByType(viewType: string): Promise<SavedView[]> {
  return invokeWithTimeout('list_saved_views_by_type', { viewType });
}

export async function deleteSavedView(id: string): Promise<void> {
  return invokeWithTimeout('delete_saved_view', { id });
}
