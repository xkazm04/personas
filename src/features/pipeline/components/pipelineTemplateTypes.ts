// ============================================================================
// Pipeline Template Types & Constants
// ============================================================================

export interface TemplateNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
}

export interface TemplateEdge {
  source: string;
  target: string;
  type: 'sequential' | 'conditional' | 'parallel' | 'feedback';
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  tags: string[];
  nodes: TemplateNode[];
  edges: TemplateEdge[];
}

export const EDGE_COLORS: Record<string, string> = {
  sequential: '#3b82f6',
  conditional: '#f59e0b',
  parallel: '#10b981',
  feedback: '#8b5cf6',
};

export const NODE_ROLE_FILLS: Record<string, string> = {
  orchestrator: '#f59e0b',
  worker: '#3b82f6',
  reviewer: '#10b981',
  router: '#8b5cf6',
};
