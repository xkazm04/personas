import { Plus } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { BehaviorCoreEditor } from "@/features/agents/components/matrix/BehaviorCoreEditor";
import { SharedResourcesPanel } from "@/features/agents/components/matrix/SharedResourcesPanel";
import { CapabilityRow } from "@/features/agents/sub_new_persona/capabilityView";
import { DebtText } from '@/i18n/DebtText';


interface GlyphEditFaceProps {
  onAddCapability: () => void;
}

export function GlyphEditFace({ onAddCapability }: GlyphEditFaceProps) {
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const hasBehaviorCore = useAgentStore((s) => s.buildBehaviorCore !== null);
  return (
    <div className="w-full max-w-3xl flex flex-col gap-5">
      {hasBehaviorCore && <BehaviorCoreEditor />}
      <section className="flex flex-col gap-3 rounded-2xl border border-border/30 bg-secondary/10 p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="typo-heading-sm text-foreground">Capabilities</h3>
            <p className="typo-body-sm text-foreground"><DebtText k="auto_tune_each_capability_s_dimensions_manually_6fb50a3a" /></p>
          </div>
          <button
            type="button"
            onClick={onAddCapability}
            className="rounded-modal bg-primary/20 px-3 py-1.5 typo-body-sm font-medium text-primary hover:bg-primary/30 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Add
          </button>
        </header>
        {capabilityOrder.length === 0 ? (
          <p className="typo-body-sm text-foreground py-4">
            <DebtText k="auto_no_capabilities_yet_start_a_build_via_the__32ba6dac" />
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {capabilityOrder.map((id) => (
              <CapabilityRow key={id} capabilityId={id} />
            ))}
          </div>
        )}
      </section>
      <SharedResourcesPanel />
    </div>
  );
}
