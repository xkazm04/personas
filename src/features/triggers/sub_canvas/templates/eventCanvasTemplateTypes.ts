import type { LucideIcon } from 'lucide-react';

export interface EventCanvasTemplateNode {
  id: string;
  label: string;
  nodeType: 'event_source' | 'persona_consumer';
  x: number;
  y: number;
  /** For event_source: the event_type this source emits */
  eventType?: string;
  /** For persona_consumer: role hint for which persona to suggest */
  personaRole?: string;
  icon?: string;
  color?: string;
}

export interface EventCanvasTemplateEdge {
  sourceNodeId: string;
  targetNodeId: string;
  eventType: string;
  sourceFilter?: string;
}

export interface EventCanvasTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  color: string;
  tags: string[];
  nodes: EventCanvasTemplateNode[];
  edges: EventCanvasTemplateEdge[];
}
