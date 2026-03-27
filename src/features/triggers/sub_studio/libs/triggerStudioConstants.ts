import {
  Clock, Globe, Webhook, Link, Radio, Clipboard, AppWindow,
  Layers, FileEdit, Bot, GitBranch, Zap,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Node type keys
// ---------------------------------------------------------------------------

export const NODE_TYPE_TRIGGER_SOURCE = 'triggerSource' as const;
export const NODE_TYPE_PERSONA_STEP = 'personaStep' as const;
export const NODE_TYPE_CONDITION_GATE = 'conditionGate' as const;
export const EDGE_TYPE_CHAIN = 'chainEdge' as const;

export { GRID_SIZE } from '@/lib/canvas/gridUtils';
export const STUDIO_LAYOUT_KEY = 'trigger_studio_layout';
export const STUDIO_LAYOUT_VERSION = 1;

// ---------------------------------------------------------------------------
// Trigger source templates (the 9 trigger types as building blocks)
// ---------------------------------------------------------------------------

export interface TriggerBlockTemplate {
  id: string;
  triggerType: string;
  label: string;
  description: string;
  icon: LucideIcon;
  color: string;
}

export const TRIGGER_BLOCK_TEMPLATES: TriggerBlockTemplate[] = [
  { id: 'blk-schedule',   triggerType: 'schedule',       label: 'Schedule',          icon: Clock,     color: 'text-amber-400',   description: 'Cron or interval trigger' },
  { id: 'blk-polling',    triggerType: 'polling',        label: 'Polling',           icon: Globe,     color: 'text-teal-400',    description: 'HTTP endpoint change detection' },
  { id: 'blk-webhook',    triggerType: 'webhook',        label: 'Webhook',           icon: Webhook,   color: 'text-blue-400',    description: 'External webhook POST' },
  { id: 'blk-chain',      triggerType: 'chain',          label: 'Chain',             icon: Link,      color: 'text-purple-400',  description: 'Fires when another persona completes' },
  { id: 'blk-event',      triggerType: 'event_listener', label: 'Event Listener',    icon: Radio,     color: 'text-cyan-400',    description: 'Listen for published events' },
  { id: 'blk-file',       triggerType: 'file_watcher',   label: 'File Watcher',      icon: FileEdit,  color: 'text-cyan-400',    description: 'Monitor filesystem changes' },
  { id: 'blk-clipboard',  triggerType: 'clipboard',      label: 'Clipboard',         icon: Clipboard, color: 'text-pink-400',    description: 'Monitor clipboard content' },
  { id: 'blk-app-focus',  triggerType: 'app_focus',      label: 'App Focus',         icon: AppWindow, color: 'text-indigo-400',  description: 'Monitor foreground app changes' },
  { id: 'blk-composite',  triggerType: 'composite',      label: 'Composite',         icon: Layers,    color: 'text-rose-400',    description: 'Multi-condition trigger with time window' },
];

export function findTriggerTemplate(triggerType: string): TriggerBlockTemplate | undefined {
  return TRIGGER_BLOCK_TEMPLATES.find(t => t.triggerType === triggerType);
}

// ---------------------------------------------------------------------------
// Node data interfaces
// ---------------------------------------------------------------------------

export interface TriggerSourceNodeData {
  triggerType: string;
  label: string;
  iconName: string;
  color: string;
  config?: string;
  [key: string]: unknown;
}

export interface PersonaStepNodeData {
  personaId: string;
  name: string;
  icon: string;
  color: string;
  enabled: boolean;
  [key: string]: unknown;
}

export interface ConditionGateNodeData {
  conditionLabel: string;
  branches: ConditionBranch[];
  [key: string]: unknown;
}

export interface ConditionBranch {
  id: string;
  label: string;
  color: string;
}

// ---------------------------------------------------------------------------
// Chain edge data
// ---------------------------------------------------------------------------

export interface ChainEdgeData {
  label?: string;
  conditionBranch?: string;
  animated?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Edge condition styles
// ---------------------------------------------------------------------------

export const CHAIN_EDGE_STYLES = {
  default:     { stroke: '#6366f1', strokeWidth: 2, label: 'Flow' },
  conditional: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 3', label: 'Conditional' },
  parallel:    { stroke: '#10b981', strokeWidth: 2, label: 'Parallel' },
} as const;

// ---------------------------------------------------------------------------
// Palette categories
// ---------------------------------------------------------------------------

export interface StudioPaletteCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
}

export const PALETTE_CATEGORIES: StudioPaletteCategory[] = [
  { id: 'triggers', label: 'Trigger Sources', icon: Zap,       color: 'text-amber-400' },
  { id: 'personas', label: 'Persona Steps',   icon: Bot,       color: 'text-emerald-400' },
  { id: 'logic',    label: 'Logic Gates',     icon: GitBranch, color: 'text-violet-400' },
];

// ---------------------------------------------------------------------------
// Default condition branches
// ---------------------------------------------------------------------------

export const DEFAULT_CONDITION_BRANCHES: ConditionBranch[] = [
  { id: 'true',  label: 'Yes / Match',    color: '#10b981' },
  { id: 'false', label: 'No / Fallback',  color: '#ef4444' },
];
