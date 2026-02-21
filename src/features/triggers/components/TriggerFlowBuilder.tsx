import { useEffect, useMemo, useState, useCallback } from "react";
import { usePersonaStore } from "@/stores/personaStore";
import {
  Link,
  Radio,
  ChevronRight,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  HelpCircle,
  Server,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";

// ─── Constants ──────────────────────────────────────────────────────────
const NODE_W = 160;
const NODE_H = 56;
const GAP_X = 220;
const GAP_Y = 90;

// ─── Types ──────────────────────────────────────────────────────────────
interface FlowNode {
  id: string;
  name: string;
  x: number;
  y: number;
  enabled: boolean;
}

interface FlowEdge {
  id: string;
  from: string;
  to: string;
  conditionType: string;
  enabled: boolean;
}

const CONDITION_ICONS: Record<string, typeof CheckCircle> = {
  success: CheckCircle,
  failure: XCircle,
  any: HelpCircle,
  jsonpath: Radio,
};

const CONDITION_COLORS: Record<string, string> = {
  success: "text-emerald-400",
  failure: "text-red-400",
  any: "text-zinc-400",
  jsonpath: "text-blue-400",
};

// ─── Component ──────────────────────────────────────────────────────────
export function TriggerFlowBuilder() {
  const fetchTriggerChains = usePersonaStore((s) => s.fetchTriggerChains);
  const fetchWebhookStatus = usePersonaStore((s) => s.fetchWebhookStatus);
  const triggerChains = usePersonaStore((s) => s.triggerChains);
  const webhookStatus = usePersonaStore((s) => s.webhookStatus);
  const personas = usePersonaStore((s) => s.personas);
  const createTrigger = usePersonaStore((s) => s.createTrigger);
  const deleteTrigger = usePersonaStore((s) => s.deleteTrigger);

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("any");

  useEffect(() => {
    fetchTriggerChains();
    fetchWebhookStatus();
  }, [fetchTriggerChains, fetchWebhookStatus]);

  // Build graph layout from chain links
  const { nodes, edges, svgWidth, svgHeight } = useMemo(() => {
    const nodeMap = new Map<string, FlowNode>();
    const edgeList: FlowEdge[] = [];

    // Collect unique personas involved in chains
    for (const chain of triggerChains) {
      if (!nodeMap.has(chain.source_persona_id)) {
        nodeMap.set(chain.source_persona_id, {
          id: chain.source_persona_id,
          name: chain.source_persona_name,
          x: 0,
          y: 0,
          enabled: true,
        });
      }
      if (!nodeMap.has(chain.target_persona_id)) {
        nodeMap.set(chain.target_persona_id, {
          id: chain.target_persona_id,
          name: chain.target_persona_name,
          x: 0,
          y: 0,
          enabled: true,
        });
      }
      edgeList.push({
        id: chain.trigger_id,
        from: chain.source_persona_id,
        to: chain.target_persona_id,
        conditionType: chain.condition_type,
        enabled: chain.enabled,
      });
    }

    // Simple left-to-right layout: sources on left, targets on right
    const sources = new Set(edgeList.map((e) => e.from));
    const targets = new Set(edgeList.map((e) => e.to));
    const pureTargets = [...targets].filter((t) => !sources.has(t));
    const pureSources = [...sources].filter((s) => !targets.has(s));
    const middle = [...sources].filter((s) => targets.has(s));

    const columns = [pureSources, middle, pureTargets].filter(
      (c) => c.length > 0,
    );

    let maxRows = 0;
    columns.forEach((col, colIdx) => {
      maxRows = Math.max(maxRows, col.length);
      col.forEach((id, rowIdx) => {
        const node = nodeMap.get(id);
        if (node) {
          node.x = 40 + colIdx * GAP_X;
          node.y = 40 + rowIdx * GAP_Y;
        }
      });
    });

    const w = Math.max(40 + columns.length * GAP_X + NODE_W, 500);
    const h = Math.max(40 + maxRows * GAP_Y + NODE_H, 200);

    return {
      nodes: [...nodeMap.values()],
      edges: edgeList,
      svgWidth: w,
      svgHeight: h,
    };
  }, [triggerChains]);

  const handleAddChain = useCallback(async () => {
    if (!selectedSource || !selectedTarget || selectedSource === selectedTarget)
      return;
    await createTrigger(selectedTarget, {
      trigger_type: "chain",
      config: {
        source_persona_id: selectedSource,
        event_type: "chain_triggered",
        condition: { type: selectedCondition },
        payload_forward: true,
      },
      enabled: true,
    });
    setShowAddModal(false);
    setSelectedSource("");
    setSelectedTarget("");
    setSelectedCondition("any");
    fetchTriggerChains();
  }, [
    selectedSource,
    selectedTarget,
    selectedCondition,
    createTrigger,
    fetchTriggerChains,
  ]);

  const handleDeleteChain = useCallback(
    async (chain: TriggerChainLink) => {
      await deleteTrigger(chain.target_persona_id, chain.trigger_id);
      fetchTriggerChains();
    },
    [deleteTrigger, fetchTriggerChains],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-3">
          <Link className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">
            Trigger Flow
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Webhook Status */}
          <div className="flex items-center gap-1.5 text-xs">
            <Server className="w-3.5 h-3.5" />
            <span className="text-muted-foreground/50">Webhook:</span>
            {webhookStatus?.listening ? (
              <span className="text-emerald-400 font-mono">
                :{webhookStatus.port}
              </span>
            ) : (
              <span className="text-red-400/60">offline</span>
            )}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-lg hover:bg-purple-500/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Chain
          </button>
        </div>
      </div>

      {/* Flow Canvas */}
      {triggerChains.length > 0 ? (
        <div className="flex-1 overflow-auto p-4">
          <svg
            width={svgWidth}
            height={svgHeight}
            className="select-none"
          >
            {/* Edges */}
            {edges.map((edge) => {
              const fromNode = nodes.find((n) => n.id === edge.from);
              const toNode = nodes.find((n) => n.id === edge.to);
              if (!fromNode || !toNode) return null;

              const x1 = fromNode.x + NODE_W;
              const y1 = fromNode.y + NODE_H / 2;
              const x2 = toNode.x;
              const y2 = toNode.y + NODE_H / 2;
              const midX = (x1 + x2) / 2;

              const color = edge.enabled
                ? CONDITION_COLORS[edge.conditionType] || "text-zinc-400"
                : "text-zinc-600";
              const strokeColor = color
                .replace("text-", "")
                .replace("-400", "");

              return (
                <g key={edge.id}>
                  <path
                    d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={`var(--color-${strokeColor})`}
                    strokeWidth={edge.enabled ? 2 : 1}
                    strokeDasharray={edge.enabled ? "none" : "4 4"}
                    opacity={edge.enabled ? 0.6 : 0.3}
                    className="transition-all duration-300"
                  />
                  {/* Arrow */}
                  <polygon
                    points={`${x2} ${y2}, ${x2 - 8} ${y2 - 4}, ${x2 - 8} ${y2 + 4}`}
                    fill={`var(--color-${strokeColor})`}
                    opacity={edge.enabled ? 0.6 : 0.3}
                  />
                  {/* Condition badge on edge */}
                  <foreignObject
                    x={midX - 30}
                    y={(y1 + y2) / 2 - 10}
                    width={60}
                    height={20}
                  >
                    <div className="flex items-center justify-center">
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md bg-background/80 border border-border/30 ${color}`}
                      >
                        {edge.conditionType}
                      </span>
                    </div>
                  </foreignObject>
                </g>
              );
            })}

            {/* Nodes */}
            {nodes.map((node) => (
              <foreignObject
                key={node.id}
                x={node.x}
                y={node.y}
                width={NODE_W}
                height={NODE_H}
              >
                <div className="w-full h-full px-3 py-2 bg-secondary/60 backdrop-blur-sm border border-border/40 rounded-xl flex items-center gap-2 hover:border-purple-500/30 transition-colors cursor-default">
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      backgroundColor: node.enabled
                        ? "rgb(16 185 129)"
                        : "rgb(113 113 122)",
                    }}
                  />
                  <span className="text-xs font-medium text-foreground/80 truncate">
                    {node.name}
                  </span>
                </div>
              </foreignObject>
            ))}
          </svg>

          {/* Chain list below canvas */}
          <div className="mt-4 space-y-2">
            {triggerChains.map((chain) => {
              const CondIcon =
                CONDITION_ICONS[chain.condition_type] || HelpCircle;
              const condColor =
                CONDITION_COLORS[chain.condition_type] || "text-zinc-400";

              return (
                <div
                  key={chain.trigger_id}
                  className="flex items-center gap-3 p-3 bg-secondary/30 border border-border/20 rounded-xl"
                >
                  <span className="text-xs font-medium text-foreground/70 truncate max-w-[120px]">
                    {chain.source_persona_name}
                  </span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                  <CondIcon className={`w-3.5 h-3.5 flex-shrink-0 ${condColor}`} />
                  <span className={`text-[10px] ${condColor}`}>
                    {chain.condition_type}
                  </span>
                  <ChevronRight className="w-3 h-3 text-muted-foreground/30 flex-shrink-0" />
                  <span className="text-xs font-medium text-foreground/70 truncate max-w-[120px]">
                    {chain.target_persona_name}
                  </span>
                  <span
                    className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-md font-mono ${
                      chain.enabled
                        ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                        : "bg-secondary/60 text-muted-foreground/40 border border-border/20"
                    }`}
                  >
                    {chain.enabled ? "On" : "Off"}
                  </span>
                  <button
                    onClick={() => handleDeleteChain(chain)}
                    className="p-1 text-muted-foreground/30 hover:text-red-400 transition-colors"
                    title="Delete chain"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Link className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/40">
              No trigger chains configured
            </p>
            <p className="text-xs text-muted-foreground/25 max-w-[280px]">
              Chain triggers let one agent&apos;s completion automatically trigger
              another agent, with optional conditions.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-2 px-4 py-2 text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-lg hover:bg-purple-500/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
              Create First Chain
            </button>
          </div>
        </div>
      )}

      {/* ── Add Chain Modal ─────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-background border border-border/40 rounded-2xl p-6 w-[400px] shadow-2xl space-y-4"
            >
              <h3 className="text-sm font-semibold text-foreground/80">
                Add Trigger Chain
              </h3>

              {/* Source Agent */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground/50">
                  When this agent completes:
                </label>
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-secondary/40 border border-border/30 rounded-lg text-foreground/80 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                >
                  <option value="">Select source agent...</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Condition */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground/50">
                  Condition:
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {(["any", "success", "failure", "jsonpath"] as const).map(
                    (cond) => {
                      const Icon = CONDITION_ICONS[cond] || HelpCircle;
                      const color = CONDITION_COLORS[cond] || "text-zinc-400";
                      return (
                        <button
                          key={cond}
                          onClick={() => setSelectedCondition(cond)}
                          className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-xs transition-colors ${
                            selectedCondition === cond
                              ? "border-purple-500/40 bg-purple-500/10"
                              : "border-border/20 bg-secondary/20 hover:border-border/40"
                          }`}
                        >
                          <Icon className={`w-3.5 h-3.5 ${color}`} />
                          <span className="capitalize text-muted-foreground/60">
                            {cond}
                          </span>
                        </button>
                      );
                    },
                  )}
                </div>
              </div>

              {/* Target Agent */}
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground/50">
                  Trigger this agent:
                </label>
                <select
                  value={selectedTarget}
                  onChange={(e) => setSelectedTarget(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-secondary/40 border border-border/30 rounded-lg text-foreground/80 focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                >
                  <option value="">Select target agent...</option>
                  {personas
                    .filter((p) => p.id !== selectedSource)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 text-xs font-medium bg-secondary/40 text-muted-foreground/60 border border-border/20 rounded-lg hover:bg-secondary/60 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddChain}
                  disabled={
                    !selectedSource ||
                    !selectedTarget ||
                    selectedSource === selectedTarget
                  }
                  className="flex-1 px-4 py-2 text-xs font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-lg hover:bg-purple-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  Create Chain
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
