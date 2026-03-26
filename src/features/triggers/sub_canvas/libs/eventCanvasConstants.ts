import {
  Clock, Globe, Webhook, Link, Radio, Eye, Clipboard, AppWindow,
  Layers, Zap, FileEdit, CheckCircle2, XCircle, Store,
  type LucideIcon,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Event source template: one draggable item in the palette
// ---------------------------------------------------------------------------

export interface EventSourceTemplate {
  /** Unique key (used as node ID prefix) */
  id: string;
  /** The event_type value this source emits / the listener should match */
  eventType: string;
  /** Human label */
  label: string;
  /** Optional source_filter pattern (e.g. "webhook-*") */
  sourceFilter?: string;
  description: string;
  icon: LucideIcon;
  /** Tailwind text color class */
  color: string;
}

export interface EventSourceCategory {
  id: string;
  label: string;
  icon: LucideIcon;
  color: string;
  templates: EventSourceTemplate[];
}

// ---------------------------------------------------------------------------
// Built-in source categories
// ---------------------------------------------------------------------------

export const EVENT_SOURCE_CATEGORIES: EventSourceCategory[] = [
  {
    id: 'triggers',
    label: 'Trigger Events',
    icon: Zap,
    color: 'text-amber-400',
    templates: [
      { id: 'src-schedule',    eventType: 'schedule_fired',   label: 'Schedule Fired',     icon: Clock,      color: 'text-amber-400',   description: 'Fires when a cron or interval trigger executes' },
      { id: 'src-polling',     eventType: 'polling_changed',  label: 'Polling Changed',    icon: Globe,      color: 'text-teal-400',    description: 'Fires when a polled endpoint returns new content' },
      { id: 'src-webhook',     eventType: 'webhook_received', label: 'Webhook Received',   icon: Webhook,    color: 'text-blue-400',    description: 'Fires when an external webhook POST arrives' },
      { id: 'src-chain',       eventType: 'chain_completed',  label: 'Chain Completed',    icon: Link,        color: 'text-purple-400',  description: 'Fires when a chained persona finishes execution' },
      { id: 'src-file',        eventType: 'file_changed',     label: 'File Changed',       icon: FileEdit,   color: 'text-cyan-400',    description: 'Fires when a watched file or directory changes' },
      { id: 'src-clipboard',   eventType: 'clipboard_changed',label: 'Clipboard Changed',  icon: Clipboard,  color: 'text-pink-400',    description: 'Fires when clipboard content changes' },
      { id: 'src-app-focus',   eventType: 'app_focus_changed',label: 'App Focus Changed',  icon: AppWindow,  color: 'text-indigo-400',  description: 'Fires when foreground application changes' },
      { id: 'src-composite',   eventType: 'composite_fired',  label: 'Composite Fired',    icon: Layers,     color: 'text-rose-400',    description: 'Fires when a multi-condition composite trigger matches' },
    ],
  },
  {
    id: 'execution',
    label: 'Execution Events',
    icon: CheckCircle2,
    color: 'text-emerald-400',
    templates: [
      { id: 'src-exec-complete', eventType: 'execution_completed', label: 'Execution Completed', icon: CheckCircle2, color: 'text-emerald-400', description: 'Fires when any persona execution completes successfully' },
      { id: 'src-exec-failed',   eventType: 'execution_failed',   label: 'Execution Failed',    icon: XCircle,      color: 'text-red-400',     description: 'Fires when a persona execution fails' },
    ],
  },
  {
    id: 'system',
    label: 'System Events',
    icon: Radio,
    color: 'text-violet-400',
    templates: [
      { id: 'src-persona-action', eventType: 'persona_action', label: 'Persona Action',  icon: Zap,   color: 'text-violet-400',  description: 'Fires when a persona emits a custom action during execution' },
      { id: 'src-emit-event',     eventType: 'emit_event',     label: 'Custom Emit',     icon: Radio,  color: 'text-violet-400',  description: 'Fires when a persona emits a custom event via EmitEvent protocol' },
    ],
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: Store,
    color: 'text-sky-400',
    templates: [],  // Populated dynamically from shared event subscriptions
  },
];

/** Flat lookup: eventType -> template */
export function findTemplateByEventType(eventType: string): EventSourceTemplate | undefined {
  for (const cat of EVENT_SOURCE_CATEGORIES) {
    const t = cat.templates.find(t => t.eventType === eventType);
    if (t) return t;
  }
  return undefined;
}

/** Default icon/color for unknown event types */
export const DEFAULT_SOURCE_ICON = Zap;
export const DEFAULT_SOURCE_COLOR = 'text-violet-400';

// ---------------------------------------------------------------------------
// Canvas grid
// ---------------------------------------------------------------------------

export { GRID_SIZE } from '@/lib/canvas/gridUtils';
export const LAYOUT_STORAGE_KEY = 'event_canvas_layout';
export const LAYOUT_VERSION = 2; // bumped for sticky notes support

// ---------------------------------------------------------------------------
// Node type keys (must match ReactFlow nodeTypes registration)
// ---------------------------------------------------------------------------

export const NODE_TYPE_EVENT_SOURCE = 'eventSource' as const;
export const NODE_TYPE_PERSONA_CONSUMER = 'personaConsumer' as const;
export const NODE_TYPE_STICKY_NOTE = 'stickyNote' as const;
export const EDGE_TYPE_EVENT = 'eventEdge' as const;

// ---------------------------------------------------------------------------
// Edge condition types
// ---------------------------------------------------------------------------

export interface EdgeConditionStyle {
  stroke: string;
  strokeWidth: number;
  strokeDasharray?: string;
  label: string;
  description: string;
}

export const EVENT_EDGE_TYPES: Record<string, EdgeConditionStyle> = {
  always:      { stroke: '#22d3ee', strokeWidth: 2, label: 'Always',      description: 'Always fire on this event' },
  conditional: { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '6 3', label: 'Conditional', description: 'Fire only if payload matches filter' },
  sampled:     { stroke: '#a78bfa', strokeWidth: 2, strokeDasharray: '2 4', label: 'Sampled',     description: 'Fire on % of events' },
};
