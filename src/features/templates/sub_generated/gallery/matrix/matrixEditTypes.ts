/**
 * Shared types and preset constants for matrix edit cells.
 */
import type { SuggestedTrigger } from '@/lib/types/designTypes';
import { Clock, Webhook, MousePointerClick, Radio, Activity } from 'lucide-react';

// ── Public interface ──────────────────────────────────────────────────

export interface MatrixEditState {
  /** Connector name → credential ID mapping */
  connectorCredentialMap: Record<string, string>;
  /** Original connector name → active swap name */
  connectorSwaps: Record<string, string>;
  /** Trigger index → user config overrides */
  triggerConfigs: Record<number, Record<string, string>>;
  /** Whether human review is required */
  requireApproval: boolean;
  /** Auto-approve severity threshold */
  autoApproveSeverity: string;
  /** Review timeout duration */
  reviewTimeout: string;
  /** Whether memory is enabled */
  memoryEnabled: boolean;
  /** Memory scope selection */
  memoryScope: string;
  /** Notification strategy preset */
  messagePreset: string;
}

export interface MatrixEditCallbacks {
  onCredentialSelect: (connectorName: string, credentialId: string) => void;
  onConnectorSwap: (originalName: string, replacementName: string) => void;
  onTriggerConfigChange: (index: number, config: Record<string, string>) => void;
  onToggleApproval: (value: boolean) => void;
  onToggleMemory: (value: boolean) => void;
  /** Generic preference setter for extended fields (severity, timeout, scope, messagePreset) */
  onPreferenceChange: (key: string, value: unknown) => void;
}

// ── Preset templates ──────────────────────────────────────────────────
// Derived from patterns across 90+ templates in scripts/templates/

export const REVIEW_PRESETS = [
  { value: 'strict', label: 'Strict Gatekeeper', approval: true, severity: '', timeout: '1h' },
  { value: 'conditional', label: 'Smart Conditional', approval: true, severity: 'info_warning', timeout: '4h' },
  { value: 'balanced', label: 'Balanced Review', approval: true, severity: 'info', timeout: '24h' },
  { value: 'autonomous', label: 'Autonomous', approval: false, severity: 'all', timeout: 'none' },
] as const;

export const MEMORY_PRESETS = [
  { value: 'full', label: 'Full Context', enabled: true, scope: 'all' },
  { value: 'patterns', label: 'Execution Patterns', enabled: true, scope: 'execution_patterns' },
  { value: 'errors', label: 'Error Intelligence', enabled: true, scope: 'error_resolutions' },
  { value: 'preferences', label: 'User Preferences', enabled: true, scope: 'user_preferences' },
  { value: 'stateless', label: 'Stateless', enabled: false, scope: '' },
] as const;

export const MESSAGE_PRESETS = [
  { value: 'critical', label: 'Alert Critical Only' },
  { value: 'updates', label: 'Full Status Updates' },
  { value: 'digest', label: 'Digest Summary' },
  { value: 'silent', label: 'Silent Logger' },
] as const;

// ── Trigger icons ─────────────────────────────────────────────────────

export const TRIGGER_ICONS: Record<SuggestedTrigger['trigger_type'], typeof Clock> = {
  schedule: Clock,
  webhook: Webhook,
  manual: MousePointerClick,
  polling: Radio,
  event: Activity,
};
