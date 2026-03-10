import { invoke } from '@tauri-apps/api/core';

export interface SavedView {
  id: string;
  name: string;
  persona_id: string | null;
  day_range: number;
  custom_start_date: string | null;
  custom_end_date: string | null;
  compare_enabled: boolean;
  is_smart: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateSavedViewInput {
  name: string;
  persona_id: string | null;
  day_range: number;
  custom_start_date: string | null;
  custom_end_date: string | null;
  compare_enabled: boolean;
  is_smart: boolean;
}

export async function createSavedView(input: CreateSavedViewInput): Promise<SavedView> {
  return invoke('create_saved_view', { input });
}

export async function listSavedViews(): Promise<SavedView[]> {
  return invoke('list_saved_views');
}

export async function deleteSavedView(id: string): Promise<void> {
  return invoke('delete_saved_view', { id });
}
