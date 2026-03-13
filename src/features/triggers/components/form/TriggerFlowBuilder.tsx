import { useEffect, useState, useCallback } from "react";
import { usePipelineStore } from "@/stores/pipelineStore";
import { useAgentStore } from "@/stores/agentStore";
import { Link, Plus, Server } from "lucide-react";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
import { useTriggerOperations } from "@/features/triggers/hooks/useTriggerOperations";
import { useFlowGraph } from "./useFlowGraph";
import { FlowCanvas } from "./FlowCanvas";
import { ChainList } from "./ChainList";
import { AddChainModal } from "./AddChainModal";

// --- Component ----------------------------------------------------------
export function TriggerFlowBuilder() {
  const fetchTriggerChains = usePipelineStore((s) => s.fetchTriggerChains);
  const fetchWebhookStatus = usePipelineStore((s) => s.fetchWebhookStatus);
  const triggerChains = usePipelineStore((s) => s.triggerChains);
  const webhookStatus = usePipelineStore((s) => s.webhookStatus);
  const personas = useAgentStore((s) => s.personas);
  const ops = useTriggerOperations("");

  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedSource, setSelectedSource] = useState("");
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedCondition, setSelectedCondition] = useState("any");

  useEffect(() => {
    fetchTriggerChains();
    fetchWebhookStatus();
  }, [fetchTriggerChains, fetchWebhookStatus]);

  const { nodes, edges, svgWidth, svgHeight } = useFlowGraph(triggerChains);

  const handleAddChain = useCallback(async () => {
    if (!selectedSource || !selectedTarget || selectedSource === selectedTarget)
      return;
    await ops.createChain(selectedSource, selectedTarget, selectedCondition);
    setShowAddModal(false);
    setSelectedSource("");
    setSelectedTarget("");
    setSelectedCondition("any");
  }, [
    selectedSource,
    selectedTarget,
    selectedCondition,
    ops,
  ]);

  const handleDeleteChain = useCallback(
    async (chain: TriggerChainLink) => {
      await ops.removeChain(chain.trigger_id, chain.target_persona_id);
    },
    [ops],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/30">
        <div className="flex items-center gap-3">
          <Link className="w-4 h-4 text-purple-400" />
          <h3 className="text-sm font-mono text-muted-foreground/90 uppercase tracking-wider">
            Trigger Flow
          </h3>
        </div>
        <div className="flex items-center gap-3">
          {/* Webhook Status */}
          <div className="flex items-center gap-1.5 text-sm">
            <Server className="w-3.5 h-3.5" />
            <span className="text-muted-foreground/90">Webhook:</span>
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
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-xl hover:bg-purple-500/25 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Chain
          </button>
        </div>
      </div>

      {/* Flow Canvas */}
      {triggerChains.length > 0 ? (
        <div className="flex-1 overflow-auto p-4">
          <FlowCanvas
            nodes={nodes}
            edges={edges}
            svgWidth={svgWidth}
            svgHeight={svgHeight}
          />
          <ChainList
            triggerChains={triggerChains}
            onDelete={handleDeleteChain}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-3">
            <Link className="w-8 h-8 text-muted-foreground/20 mx-auto" />
            <p className="text-sm text-muted-foreground/80">
              No trigger chains configured
            </p>
            <p className="text-sm text-muted-foreground/80 max-w-[280px]">
              Chain triggers let one agent&apos;s completion automatically trigger
              another agent, with optional conditions.
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="mt-2 px-4 py-2 text-sm font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-xl hover:bg-purple-500/25 transition-colors"
            >
              <Plus className="w-3.5 h-3.5 inline-block mr-1.5 -mt-0.5" />
              Create First Chain
            </button>
          </div>
        </div>
      )}

      {/* Add Chain Modal */}
      <AddChainModal
        show={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddChain}
        personas={personas}
        selectedSource={selectedSource}
        onSourceChange={setSelectedSource}
        selectedTarget={selectedTarget}
        onTargetChange={setSelectedTarget}
        selectedCondition={selectedCondition}
        onConditionChange={setSelectedCondition}
      />
    </div>
  );
}
