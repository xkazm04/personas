import { ArrowLeft, Play, Square, ArrowDownToLine, ArrowUpFromLine, Bot } from 'lucide-react';

interface WorkflowToolbarProps {
  workflowName: string;
  isExecuting: boolean;
  onBack: () => void;
  onAddPersonaNode: () => void;
  onAddInputNode: () => void;
  onAddOutputNode: () => void;
  onExecute: () => void;
  onCancel: () => void;
}

export default function WorkflowToolbar({
  workflowName,
  isExecuting,
  onBack,
  onAddPersonaNode,
  onAddInputNode,
  onAddOutputNode,
  onExecute,
  onCancel,
}: WorkflowToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/10 bg-secondary/30">
      <button
        onClick={onBack}
        className="p-1.5 rounded-lg hover:bg-secondary/60 transition-colors"
        title="Back to workflows"
      >
        <ArrowLeft className="w-4 h-4 text-muted-foreground" />
      </button>

      <h2 className="text-sm font-semibold text-foreground/90 truncate max-w-[200px]">
        {workflowName}
      </h2>

      <div className="flex-1" />

      {/* Add nodes */}
      <div className="flex items-center gap-1 mr-2">
        <button
          onClick={onAddInputNode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-500/10 border border-blue-500/25 text-blue-400 hover:bg-blue-500/20 transition-colors"
          title="Add Input node"
        >
          <ArrowDownToLine className="w-3 h-3" />
          Input
        </button>
        <button
          onClick={onAddPersonaNode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-400 hover:bg-indigo-500/20 transition-colors"
          title="Add Persona node"
        >
          <Bot className="w-3 h-3" />
          Persona
        </button>
        <button
          onClick={onAddOutputNode}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          title="Add Output node"
        >
          <ArrowUpFromLine className="w-3 h-3" />
          Output
        </button>
      </div>

      {/* Execute / Cancel */}
      {isExecuting ? (
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
        >
          <Square className="w-3 h-3" />
          Cancel
        </button>
      ) : (
        <button
          onClick={onExecute}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/25 transition-colors"
        >
          <Play className="w-3 h-3" />
          Run
        </button>
      )}
    </div>
  );
}
