import { ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import type { CapabilityState } from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
  expanded: boolean;
  onToggleExpand: () => void;
}

export function RowHeader({ capability, expanded, onToggleExpand }: Props) {
  const { t } = useTranslation();
  const patchCapability = useAgentStore((s) => s.patchCapability);
  const removeCapability = useAgentStore((s) => s.removeCapability);
  const { id } = capability;

  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        onClick={onToggleExpand}
        className="mt-1 rounded-full p-1 text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
        aria-label={expanded ? t.matrix_v3.capability_row_collapse : t.matrix_v3.capability_row_expand}
        aria-expanded={expanded}
        data-testid={`capability-row-toggle-${id}`}
      >
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
      </button>

      <div className="flex-1 min-w-0">
        <input
          type="text"
          value={capability.title}
          onChange={(e) => patchCapability(id, { title: e.target.value })}
          className="w-full border-none bg-transparent typo-heading-xs text-foreground focus:outline-none"
          data-testid={`capability-title-${id}`}
        />
        <input
          type="text"
          value={capability.capability_summary}
          onChange={(e) => patchCapability(id, { capability_summary: e.target.value })}
          className="mt-0.5 w-full border-none bg-transparent typo-body-sm text-foreground/60 focus:outline-none"
          data-testid={`capability-summary-${id}`}
        />
      </div>

      <button
        type="button"
        onClick={() => removeCapability(id)}
        className="rounded-full p-1.5 text-foreground/40 hover:bg-red-500/10 hover:text-red-500"
        aria-label={t.matrix_v3.capability_row_remove}
        data-testid={`capability-row-remove-${id}`}
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
