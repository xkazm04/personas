import { ChevronRight, HelpCircle, Trash2 } from "lucide-react";
import type { TriggerChainLink } from "@/lib/bindings/TriggerChainLink";
import { CONDITION_ICONS, CONDITION_COLORS } from "./triggerFlowConstants";

interface ChainListProps {
  triggerChains: TriggerChainLink[];
  onDelete: (chain: TriggerChainLink) => void;
}

export function ChainList({ triggerChains, onDelete }: ChainListProps) {
  return (
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
            <span className="text-sm font-medium text-foreground/90 truncate max-w-[120px]">
              {chain.source_persona_name}
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/80 flex-shrink-0" />
            <CondIcon className={`w-3.5 h-3.5 flex-shrink-0 ${condColor}`} />
            <span className={`text-sm ${condColor}`}>
              {chain.condition_type}
            </span>
            <ChevronRight className="w-3 h-3 text-muted-foreground/80 flex-shrink-0" />
            <span className="text-sm font-medium text-foreground/90 truncate max-w-[120px]">
              {chain.target_persona_name}
            </span>
            <span
              className={`ml-auto text-sm px-1.5 py-0.5 rounded-lg font-mono ${
                chain.enabled
                  ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20"
                  : "bg-secondary/60 text-muted-foreground/80 border border-border/20"
              }`}
            >
              {chain.enabled ? "On" : "Off"}
            </span>
            <button
              onClick={() => onDelete(chain)}
              className="p-1 text-muted-foreground/80 hover:text-red-400 transition-colors"
              title="Delete chain"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
