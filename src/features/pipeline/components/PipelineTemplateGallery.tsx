import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap, ChevronRight, LayoutTemplate } from 'lucide-react';
import { ROLE_COLORS } from '../sub_canvas/teamConstants';

// ============================================================================
// Template Definitions
// ============================================================================

interface TemplateNode {
  id: string;
  label: string;
  role: string;
  x: number;
  y: number;
}

interface TemplateEdge {
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

const EDGE_COLORS: Record<string, string> = {
  sequential: '#3b82f6',
  conditional: '#f59e0b',
  parallel: '#10b981',
  feedback: '#8b5cf6',
};

export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    id: 'code-review-chain',
    name: 'Code Review Chain',
    description: 'Linear review pipeline: code, review, merge',
    icon: '🔍',
    color: '#3b82f6',
    tags: ['development', 'review'],
    nodes: [
      { id: 'coder', label: 'Coder', role: 'worker', x: 20, y: 50 },
      { id: 'reviewer', label: 'Reviewer', role: 'reviewer', x: 50, y: 50 },
      { id: 'merger', label: 'Merger', role: 'worker', x: 80, y: 50 },
    ],
    edges: [
      { source: 'coder', target: 'reviewer', type: 'sequential' },
      { source: 'reviewer', target: 'merger', type: 'sequential' },
      { source: 'reviewer', target: 'coder', type: 'feedback' },
    ],
  },
  {
    id: 'content-pipeline',
    name: 'Content Pipeline',
    description: 'End-to-end content production flow',
    icon: '📝',
    color: '#8b5cf6',
    tags: ['content', 'writing'],
    nodes: [
      { id: 'researcher', label: 'Researcher', role: 'worker', x: 10, y: 50 },
      { id: 'writer', label: 'Writer', role: 'worker', x: 37, y: 50 },
      { id: 'editor', label: 'Editor', role: 'reviewer', x: 63, y: 50 },
      { id: 'publisher', label: 'Publisher', role: 'worker', x: 90, y: 50 },
    ],
    edges: [
      { source: 'researcher', target: 'writer', type: 'sequential' },
      { source: 'writer', target: 'editor', type: 'sequential' },
      { source: 'editor', target: 'publisher', type: 'sequential' },
      { source: 'editor', target: 'writer', type: 'feedback' },
    ],
  },
  {
    id: 'support-triage',
    name: 'Support Triage',
    description: 'Route requests to specialist agents',
    icon: '🎯',
    color: '#f59e0b',
    tags: ['support', 'routing'],
    nodes: [
      { id: 'router', label: 'Router', role: 'router', x: 20, y: 50 },
      { id: 'specialist-a', label: 'Specialist A', role: 'worker', x: 75, y: 18 },
      { id: 'specialist-b', label: 'Specialist B', role: 'worker', x: 75, y: 50 },
      { id: 'escalation', label: 'Escalation', role: 'worker', x: 75, y: 82 },
    ],
    edges: [
      { source: 'router', target: 'specialist-a', type: 'conditional' },
      { source: 'router', target: 'specialist-b', type: 'conditional' },
      { source: 'router', target: 'escalation', type: 'conditional' },
    ],
  },
  {
    id: 'etl-pipeline',
    name: 'Data Processing (ETL)',
    description: 'Collect, transform, validate, and load data',
    icon: '🔄',
    color: '#10b981',
    tags: ['data', 'etl'],
    nodes: [
      { id: 'collector', label: 'Collector', role: 'worker', x: 10, y: 50 },
      { id: 'transformer', label: 'Transformer', role: 'worker', x: 37, y: 50 },
      { id: 'validator', label: 'Validator', role: 'reviewer', x: 63, y: 50 },
      { id: 'loader', label: 'Loader', role: 'worker', x: 90, y: 50 },
    ],
    edges: [
      { source: 'collector', target: 'transformer', type: 'sequential' },
      { source: 'transformer', target: 'validator', type: 'sequential' },
      { source: 'validator', target: 'loader', type: 'sequential' },
    ],
  },
  {
    id: 'orchestrated-team',
    name: 'Orchestrated Team',
    description: 'Central coordinator with parallel workers',
    icon: '🎪',
    color: '#ec4899',
    tags: ['orchestration', 'parallel'],
    nodes: [
      { id: 'orchestrator', label: 'Orchestrator', role: 'orchestrator', x: 20, y: 50 },
      { id: 'worker-a', label: 'Worker A', role: 'worker', x: 70, y: 18 },
      { id: 'worker-b', label: 'Worker B', role: 'worker', x: 70, y: 50 },
      { id: 'worker-c', label: 'Worker C', role: 'worker', x: 70, y: 82 },
    ],
    edges: [
      { source: 'orchestrator', target: 'worker-a', type: 'parallel' },
      { source: 'orchestrator', target: 'worker-b', type: 'parallel' },
      { source: 'orchestrator', target: 'worker-c', type: 'parallel' },
    ],
  },
  {
    id: 'quality-gate',
    name: 'Quality Gate',
    description: 'Build-test-review-deploy with feedback loop',
    icon: '🛡️',
    color: '#06b6d4',
    tags: ['ci-cd', 'quality'],
    nodes: [
      { id: 'developer', label: 'Developer', role: 'worker', x: 10, y: 50 },
      { id: 'tester', label: 'Tester', role: 'worker', x: 37, y: 50 },
      { id: 'reviewer', label: 'Reviewer', role: 'reviewer', x: 63, y: 50 },
      { id: 'deployer', label: 'Deployer', role: 'worker', x: 90, y: 50 },
    ],
    edges: [
      { source: 'developer', target: 'tester', type: 'sequential' },
      { source: 'tester', target: 'reviewer', type: 'sequential' },
      { source: 'reviewer', target: 'deployer', type: 'sequential' },
      { source: 'reviewer', target: 'developer', type: 'feedback' },
    ],
  },
  {
    id: 'research-synthesis',
    name: 'Research & Report',
    description: 'Parallel research with synthesis and review',
    icon: '🔬',
    color: '#6366f1',
    tags: ['research', 'analysis'],
    nodes: [
      { id: 'researcher-a', label: 'Researcher A', role: 'worker', x: 15, y: 25 },
      { id: 'researcher-b', label: 'Researcher B', role: 'worker', x: 15, y: 75 },
      { id: 'analyst', label: 'Analyst', role: 'worker', x: 50, y: 50 },
      { id: 'reviewer', label: 'Reviewer', role: 'reviewer', x: 85, y: 50 },
    ],
    edges: [
      { source: 'researcher-a', target: 'analyst', type: 'parallel' },
      { source: 'researcher-b', target: 'analyst', type: 'parallel' },
      { source: 'analyst', target: 'reviewer', type: 'sequential' },
      { source: 'reviewer', target: 'analyst', type: 'feedback' },
    ],
  },
  {
    id: 'creative-studio',
    name: 'Creative Studio',
    description: 'Ideate, design, critique, and refine iteratively',
    icon: '🎨',
    color: '#f43f5e',
    tags: ['creative', 'design'],
    nodes: [
      { id: 'brainstormer', label: 'Brainstormer', role: 'worker', x: 10, y: 50 },
      { id: 'designer', label: 'Designer', role: 'worker', x: 37, y: 50 },
      { id: 'critic', label: 'Critic', role: 'reviewer', x: 63, y: 50 },
      { id: 'refiner', label: 'Refiner', role: 'worker', x: 90, y: 50 },
    ],
    edges: [
      { source: 'brainstormer', target: 'designer', type: 'sequential' },
      { source: 'designer', target: 'critic', type: 'sequential' },
      { source: 'critic', target: 'refiner', type: 'sequential' },
      { source: 'critic', target: 'designer', type: 'feedback' },
    ],
  },
  {
    id: 'approval-workflow',
    name: 'Approval Workflow',
    description: 'Multi-level approval with escalation path',
    icon: '✅',
    color: '#22c55e',
    tags: ['approval', 'governance'],
    nodes: [
      { id: 'submitter', label: 'Submitter', role: 'worker', x: 10, y: 50 },
      { id: 'reviewer-l1', label: 'Reviewer L1', role: 'reviewer', x: 40, y: 30 },
      { id: 'reviewer-l2', label: 'Reviewer L2', role: 'reviewer', x: 70, y: 30 },
      { id: 'escalation', label: 'Escalation', role: 'orchestrator', x: 55, y: 75 },
    ],
    edges: [
      { source: 'submitter', target: 'reviewer-l1', type: 'sequential' },
      { source: 'reviewer-l1', target: 'reviewer-l2', type: 'sequential' },
      { source: 'reviewer-l1', target: 'escalation', type: 'conditional' },
      { source: 'escalation', target: 'reviewer-l2', type: 'sequential' },
    ],
  },
];

// ============================================================================
// Mini Canvas SVG — renders topology shape
// ============================================================================

const NODE_ROLE_FILLS: Record<string, string> = {
  orchestrator: '#f59e0b',
  worker: '#3b82f6',
  reviewer: '#10b981',
  router: '#8b5cf6',
};

function MiniCanvas({ template, hovered }: { template: PipelineTemplate; hovered: boolean }) {
  const w = 160;
  const h = 80;
  const r = hovered ? 7 : 6;

  const nodeMap = new Map(template.nodes.map((n) => [n.id, n]));

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
      {/* Edges */}
      {template.edges.map((edge, i) => {
        const src = nodeMap.get(edge.source);
        const tgt = nodeMap.get(edge.target);
        if (!src || !tgt) return null;
        const sx = (src.x / 100) * w;
        const sy = (src.y / 100) * h;
        const tx = (tgt.x / 100) * w;
        const ty = (tgt.y / 100) * h;
        const color = EDGE_COLORS[edge.type] || '#3b82f6';
        const dashArray = edge.type === 'feedback' ? '3 3' : edge.type === 'conditional' ? '4 2' : undefined;

        // Curved path for feedback edges
        if (edge.type === 'feedback') {
          const midX = (sx + tx) / 2;
          const midY = Math.min(sy, ty) - 14;
          return (
            <path
              key={i}
              d={`M ${sx} ${sy} Q ${midX} ${midY} ${tx} ${ty}`}
              fill="none"
              stroke={color}
              strokeWidth={1}
              strokeDasharray={dashArray}
              opacity={hovered ? 0.7 : 0.4}
              className="transition-opacity duration-200"
            />
          );
        }

        return (
          <line
            key={i}
            x1={sx} y1={sy}
            x2={tx} y2={ty}
            stroke={color}
            strokeWidth={1.2}
            strokeDasharray={dashArray}
            opacity={hovered ? 0.6 : 0.35}
            className="transition-opacity duration-200"
          />
        );
      })}
      {/* Nodes */}
      {template.nodes.map((node) => {
        const cx = (node.x / 100) * w;
        const cy = (node.y / 100) * h;
        const fill = NODE_ROLE_FILLS[node.role] || '#6366f1';
        return (
          <g key={node.id}>
            <circle
              cx={cx} cy={cy} r={r}
              fill={fill}
              opacity={hovered ? 0.85 : 0.55}
              className="transition-all duration-200"
            />
            <circle
              cx={cx} cy={cy} r={r + 3}
              fill="none"
              stroke={fill}
              strokeWidth={1}
              opacity={hovered ? 0.25 : 0}
              className="transition-opacity duration-200"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ============================================================================
// Role Legend (shown in expanded details)
// ============================================================================

function RoleBadge({ role }: { role: string }) {
  const colors = ROLE_COLORS[role] || { bg: 'bg-zinc-500/15', text: 'text-zinc-400', border: 'border-zinc-500/25' };
  return (
    <span className={`inline-flex px-1.5 py-0.5 text-[10px] font-mono rounded-md ${colors.bg} ${colors.text} ${colors.border} border`}>
      {role}
    </span>
  );
}

// ============================================================================
// Gallery Component
// ============================================================================

interface PipelineTemplateGalleryProps {
  onAdopt: (template: PipelineTemplate) => void;
}

export default function PipelineTemplateGallery({ onAdopt }: PipelineTemplateGalleryProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 mb-4">
        <LayoutTemplate className="w-4 h-4 text-indigo-400/60" />
        <h2 className="text-sm font-semibold text-foreground/80 uppercase tracking-wider">Starter Templates</h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PIPELINE_TEMPLATES.map((tpl, i) => {
          const isHovered = hoveredId === tpl.id;
          const isExpanded = expandedId === tpl.id;

          return (
            <motion.div
              key={tpl.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.2 }}
              className="relative group"
            >
              <div
                className={`rounded-xl border transition-all duration-200 cursor-pointer overflow-hidden ${
                  isExpanded
                    ? 'bg-secondary/50 border-indigo-500/25 shadow-[0_0_16px_rgba(99,102,241,0.06)]'
                    : 'bg-secondary/30 border-primary/10 hover:border-indigo-500/20 hover:bg-secondary/40'
                }`}
                onMouseEnter={() => setHoveredId(tpl.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setExpandedId(isExpanded ? null : tpl.id)}
              >
                {/* Top accent */}
                <div
                  className="h-[2px] opacity-50"
                  style={{ backgroundColor: tpl.color }}
                />

                <div className="p-3">
                  {/* Header row */}
                  <div className="flex items-start gap-3">
                    {/* Mini canvas */}
                    <div className="rounded-lg bg-background/40 border border-primary/8 p-1">
                      <MiniCanvas template={tpl} hovered={isHovered || isExpanded} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-base leading-none">{tpl.icon}</span>
                        <h3 className="text-sm font-semibold text-foreground/90 truncate">{tpl.name}</h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
                        {tpl.description}
                      </p>
                      <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground/60 font-mono">
                        <span>{tpl.nodes.length} nodes</span>
                        <span className="opacity-40">·</span>
                        <span>{tpl.edges.length} edges</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3 pt-1 border-t border-primary/8">
                        {/* Node list */}
                        <div className="space-y-1 mb-3">
                          {tpl.nodes.map((node) => (
                            <div key={node.id} className="flex items-center gap-2">
                              <div
                                className="w-2 h-2 rounded-full shrink-0"
                                style={{ backgroundColor: NODE_ROLE_FILLS[node.role] || '#6366f1' }}
                              />
                              <span className="text-[11px] text-foreground/80 truncate">{node.label}</span>
                              <RoleBadge role={node.role} />
                            </div>
                          ))}
                        </div>

                        {/* Connection legend */}
                        <div className="flex flex-wrap gap-1.5 mb-3">
                          {[...new Set(tpl.edges.map((e) => e.type))].map((type) => (
                            <span
                              key={type}
                              className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded bg-background/40 border border-primary/8"
                            >
                              <span
                                className="w-3 h-[2px] rounded-full inline-block"
                                style={{ backgroundColor: EDGE_COLORS[type] }}
                              />
                              <span className="text-muted-foreground/70">{type}</span>
                            </span>
                          ))}
                        </div>

                        {/* Adopt button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onAdopt(tpl);
                          }}
                          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all"
                          style={{
                            backgroundColor: tpl.color + '18',
                            borderColor: tpl.color + '30',
                            color: tpl.color,
                            border: '1px solid',
                          }}
                        >
                          <Zap className="w-3.5 h-3.5" />
                          Use Template
                          <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
