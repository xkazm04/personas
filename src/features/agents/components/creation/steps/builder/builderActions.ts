import type { NotificationChannel } from '@/lib/types/frontendTypes';
import type { AgentIR } from '@/lib/types/designTypes';
import type { BuilderUseCase, TriggerPreset, ComponentRole } from './types';

// ── Actions ─────────────────────────────────────────────────────────

export type BuilderAction =
  | { type: 'SET_INTENT'; payload: string }
  | { type: 'ADD_USE_CASE' }
  | { type: 'ADD_USE_CASE_WITH_DATA'; payload: { title: string; description: string; category?: string } }
  | { type: 'UPDATE_USE_CASE'; payload: { id: string; updates: Partial<BuilderUseCase> } }
  | { type: 'REMOVE_USE_CASE'; payload: string }
  | { type: 'REORDER_USE_CASES'; payload: { fromIndex: number; toIndex: number } }
  | { type: 'ADD_COMPONENT'; payload: { role: ComponentRole; connectorName: string; credentialId: string | null } }
  | { type: 'REMOVE_COMPONENT'; payload: string } // component id
  | { type: 'AUTO_MATCH_CREDENTIALS'; payload: { credentials: Array<{ id: string; service_type: string }> } }
  | { type: 'UPDATE_COMPONENT_CREDENTIAL'; payload: { componentId: string; credentialId: string | null } }
  | { type: 'SET_GLOBAL_TRIGGER'; payload: TriggerPreset | null }
  | { type: 'TOGGLE_CHANNEL'; payload: NotificationChannel }
  | { type: 'UPDATE_CHANNEL'; payload: { index: number; config: Record<string, string> } }
  | { type: 'SET_ERROR_STRATEGY'; payload: string }
  | { type: 'SET_REVIEW_POLICY'; payload: string }
  | { type: 'SET_WATCHED_TABLES'; payload: { componentId: string; tables: string[] } }
  | { type: 'APPLY_DESIGN_RESULT'; payload: AgentIR }
  | { type: 'RESET' };

// ── ID Generator ────────────────────────────────────────────────────

let nextId = 1;

export function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${nextId++}`;
}
