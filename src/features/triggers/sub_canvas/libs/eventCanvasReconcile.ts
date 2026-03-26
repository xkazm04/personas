import type { Node, Edge } from '@xyflow/react';
import type { PersonaTrigger } from '@/lib/bindings/PersonaTrigger';
import type { Persona } from '@/lib/bindings/Persona';
import {
  findTemplateByEventType,
  DEFAULT_SOURCE_ICON,
  DEFAULT_SOURCE_COLOR,
  NODE_TYPE_EVENT_SOURCE,
  NODE_TYPE_PERSONA_CONSUMER,
  EDGE_TYPE_EVENT,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
} from './eventCanvasConstants';

// ---------------------------------------------------------------------------
// Layout persistence types
// ---------------------------------------------------------------------------

export interface SavedNodePosition {
  id: string;
  x: number;
  y: number;
  type: 'source' | 'consumer' | 'sticky';
}

export interface SavedStickyNote {
  id: string;
  x: number;
  y: number;
  text: string;
  category: string;
}

export interface SavedLayout {
  version: number;
  nodes: SavedNodePosition[];
  stickyNotes?: SavedStickyNote[];
}

// ---------------------------------------------------------------------------
// Node data interfaces
// ---------------------------------------------------------------------------

export interface EventSourceNodeData {
  eventType: string;
  label: string;
  iconName: string;
  color: string;
  sourceFilter?: string;
  liveEventCount: number;
  lastEventAt: string | null;
  [key: string]: unknown;
}

export interface PersonaConsumerNodeData {
  personaId: string;
  name: string;
  icon: string;
  color: string;
  enabled: boolean;
  lastExecutionAt: string | null;
  executionStatus: 'idle' | 'running' | 'completed' | 'failed' | null;
  connectedEventCount: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Parse event_listener config
// ---------------------------------------------------------------------------

interface EventListenerConfig {
  listen_event_type?: string;
  source_filter?: string;
}

function parseEventListenerConfig(trigger: PersonaTrigger): EventListenerConfig | null {
  if (trigger.trigger_type !== 'event_listener' || !trigger.config) return null;
  try {
    return JSON.parse(trigger.config) as EventListenerConfig;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Auto-layout helpers
// ---------------------------------------------------------------------------

const SOURCE_X = 100;
const CONSUMER_X = 500;
const START_Y = 80;
const Y_GAP = 120;

// ---------------------------------------------------------------------------
// Reconcile triggers + saved layout -> React Flow nodes + edges
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  nodes: Node[];
  edges: Edge[];
}

export function reconcileCanvasWithTriggers(
  allTriggers: PersonaTrigger[],
  personas: Persona[],
): ReconcileResult {
  const saved = loadLayout();
  const posMap = new Map<string, { x: number; y: number }>();
  if (saved) {
    for (const n of saved.nodes) posMap.set(n.id, { x: n.x, y: n.y });
  }

  // Filter to event_listener triggers only
  const listeners = allTriggers.filter(t => t.trigger_type === 'event_listener');

  // Group by listen_event_type
  const sourceMap = new Map<string, { eventType: string; sourceFilter?: string; triggerIds: string[]; personaIds: string[] }>();
  for (const t of listeners) {
    const cfg = parseEventListenerConfig(t);
    if (!cfg?.listen_event_type) continue;
    const key = cfg.listen_event_type;
    let entry = sourceMap.get(key);
    if (!entry) {
      entry = { eventType: key, sourceFilter: cfg.source_filter, triggerIds: [], personaIds: [] };
      sourceMap.set(key, entry);
    }
    entry.triggerIds.push(t.id);
    entry.personaIds.push(t.persona_id);
  }

  // Build persona lookup
  const personaLookup = new Map<string, Persona>();
  for (const p of personas) personaLookup.set(p.id, p);

  // Collect unique consumer persona IDs
  const consumerPersonaIds = new Set<string>();
  for (const entry of sourceMap.values()) {
    for (const pid of entry.personaIds) consumerPersonaIds.add(pid);
  }

  // Build source nodes
  const nodes: Node[] = [];
  let sourceIdx = 0;
  const sourceNodeIds = new Map<string, string>(); // eventType -> nodeId

  for (const [eventType, entry] of sourceMap) {
    const nodeId = `src-${eventType}`;
    sourceNodeIds.set(eventType, nodeId);
    const template = findTemplateByEventType(eventType);
    const pos = posMap.get(nodeId) ?? { x: SOURCE_X, y: START_Y + sourceIdx * Y_GAP };

    nodes.push({
      id: nodeId,
      type: NODE_TYPE_EVENT_SOURCE,
      position: pos,
      data: {
        eventType,
        label: template?.label ?? eventType,
        iconName: template?.icon?.displayName ?? DEFAULT_SOURCE_ICON.displayName ?? 'Zap',
        color: template?.color ?? DEFAULT_SOURCE_COLOR,
        sourceFilter: entry.sourceFilter,
        liveEventCount: 0,
        lastEventAt: null,
      } satisfies EventSourceNodeData,
    });
    sourceIdx++;
  }

  // Build consumer nodes
  let consumerIdx = 0;
  for (const pid of consumerPersonaIds) {
    const persona = personaLookup.get(pid);
    if (!persona) continue;
    const nodeId = pid;
    const pos = posMap.get(nodeId) ?? { x: CONSUMER_X, y: START_Y + consumerIdx * Y_GAP };

    nodes.push({
      id: nodeId,
      type: NODE_TYPE_PERSONA_CONSUMER,
      position: pos,
      data: {
        personaId: pid,
        name: persona.name,
        icon: persona.icon ?? '',
        color: persona.color ?? 'text-blue-400',
        enabled: persona.enabled,
        lastExecutionAt: null,
        executionStatus: null,
        connectedEventCount: 0,
      } satisfies PersonaConsumerNodeData,
    });
    consumerIdx++;
  }

  // Build edges
  const edges: Edge[] = [];
  for (const t of listeners) {
    const cfg = parseEventListenerConfig(t);
    if (!cfg?.listen_event_type) continue;
    const sourceNodeId = sourceNodeIds.get(cfg.listen_event_type);
    if (!sourceNodeId) continue;

    edges.push({
      id: `edge-${t.id}`,
      source: sourceNodeId,
      target: t.persona_id,
      type: EDGE_TYPE_EVENT,
      data: {
        triggerId: t.id,
        eventType: cfg.listen_event_type,
        sourceFilter: cfg.source_filter ?? null,
      },
    });
  }

  // Update connectedEventCount on consumer nodes
  for (const node of nodes) {
    if (node.type === NODE_TYPE_PERSONA_CONSUMER) {
      const count = edges.filter(e => e.target === node.id).length;
      (node.data as PersonaConsumerNodeData).connectedEventCount = count;
    }
  }

  return { nodes, edges };
}

// ---------------------------------------------------------------------------
// Layout persistence (localStorage)
// ---------------------------------------------------------------------------

function parseLayout(raw: string | null | undefined): SavedLayout | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SavedLayout;
    // Accept both v1 and v2
    if (parsed.version !== LAYOUT_VERSION && parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function loadLayout(): SavedLayout | null {
  return parseLayout(localStorage.getItem(LAYOUT_STORAGE_KEY));
}

export function saveLayout(nodes: Node[], stickyNotes?: SavedStickyNote[]): void {
  const layout: SavedLayout = {
    version: LAYOUT_VERSION,
    nodes: nodes.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      type: n.type === NODE_TYPE_EVENT_SOURCE ? 'source' as const
           : n.type === 'stickyNote' ? 'sticky' as const
           : 'consumer' as const,
    })),
    stickyNotes,
  };
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // non-critical
  }
}
