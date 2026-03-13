import { HelpCircle } from "lucide-react";
import { BaseModal } from "@/lib/ui/BaseModal";
import { ThemedSelect } from "@/features/shared/components/forms/ThemedSelect";
import { CONDITION_ICONS, CONDITION_COLORS } from "./triggerFlowConstants";

interface Persona {
  id: string;
  name: string;
}

interface AddChainModalProps {
  show: boolean;
  onClose: () => void;
  onSubmit: () => void;
  personas: Persona[];
  selectedSource: string;
  onSourceChange: (value: string) => void;
  selectedTarget: string;
  onTargetChange: (value: string) => void;
  selectedCondition: string;
  onConditionChange: (value: string) => void;
}

export function AddChainModal({
  show,
  onClose,
  onSubmit,
  personas,
  selectedSource,
  onSourceChange,
  selectedTarget,
  onTargetChange,
  selectedCondition,
  onConditionChange,
}: AddChainModalProps) {
  return (
    <BaseModal
      isOpen={show}
      onClose={onClose}
      titleId="add-chain-title"
      panelClassName="bg-background border border-border/40 rounded-xl p-6 w-[400px] shadow-2xl space-y-4"
      maxWidthClass="max-w-md"
    >
      <h3 id="add-chain-title" className="text-sm font-semibold text-foreground/80">
        Add Trigger Chain
      </h3>

      {/* Source Agent */}
      <div className="space-y-1.5">
        <label className="text-sm text-muted-foreground/90">
          When this agent completes:
        </label>
        <ThemedSelect
          value={selectedSource}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          <option value="">Select source agent...</option>
          {personas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </ThemedSelect>
      </div>

      {/* Condition */}
      <div className="space-y-1.5">
        <label className="text-sm text-muted-foreground/90">
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
                  onClick={() => onConditionChange(cond)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-lg border text-sm transition-colors ${
                    selectedCondition === cond
                      ? "border-purple-500/40 bg-purple-500/10"
                      : "border-border/20 bg-secondary/20 hover:border-border/40"
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                  <span className="capitalize text-muted-foreground/80">
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
        <label className="text-sm text-muted-foreground/90">
          Trigger this agent:
        </label>
        <ThemedSelect
          value={selectedTarget}
          onChange={(e) => onTargetChange(e.target.value)}
        >
          <option value="">Select target agent...</option>
          {personas
            .filter((p) => p.id !== selectedSource)
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </ThemedSelect>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-2">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 text-sm font-medium bg-secondary/40 text-muted-foreground/80 border border-border/20 rounded-xl hover:bg-secondary/60 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={
            !selectedSource ||
            !selectedTarget ||
            selectedSource === selectedTarget
          }
          className="flex-1 px-4 py-2 text-sm font-medium bg-purple-500/15 text-purple-400 border border-purple-500/20 rounded-xl hover:bg-purple-500/25 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          Create Chain
        </button>
      </div>
    </BaseModal>
  );
}
