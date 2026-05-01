import { useCallback, useState } from "react";
import { useAgentStore } from "@/stores/agentStore";
import { CapabilityRowHeader } from "./CapabilityRowHeader";
import { CapabilityRowSummary } from "./CapabilityRowSummary";
import { CapabilityRowTabs } from "./CapabilityRowTabs";

interface Props {
  capabilityId: string;
}

export function CapabilityRow({ capabilityId }: Props) {
  const capability = useAgentStore((s) => s.buildCapabilities[capabilityId]);
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((p) => !p), []);

  if (!capability) return null;

  return (
    <article
      className="rounded-2xl border border-border/30 bg-background/40 transition hover:border-border/50"
      data-testid={`capability-row-${capabilityId}`}
      data-capability-id={capabilityId}
      data-expanded={expanded}
    >
      <div className="flex flex-col gap-3 p-4">
        <CapabilityRowHeader
          capability={capability}
          expanded={expanded}
          onToggleExpand={toggle}
        />
        {!expanded ? <CapabilityRowSummary capability={capability} /> : null}
      </div>

      {expanded ? (
        <div className="border-t border-border/20 p-4">
          <CapabilityRowTabs capability={capability} />
        </div>
      ) : null}
    </article>
  );
}
