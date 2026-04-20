// @ts-nocheck
// WIP — UI variant prototype per ui-variant-prototype skill. Not yet wired
// into production adoption flow. Type cleanup lands when one variant wins.
"use client";

/**
 * Demo parent for the two TriggerComposition variants behind a tab
 * switcher. Mounted manually at an adoption-flow entry point so the
 * user can preview both approaches on the same fixture data.
 *
 * Production integration lands after the variant decision — one of
 * the two variants becomes the real step inserted between
 * UseCasePickerStep and QuestionnaireFormGrid.
 */

import { useState } from "react";
import { Grid3x3, Layers } from "lucide-react";
import TriggerCompositionStepChips from "./TriggerCompositionStepChips";
import TriggerCompositionStepMaster from "./TriggerCompositionStepMaster";
import type { UseCase } from "./TriggerCompositionStepChips";

type ViewVariant = "chips" | "master";

const VIEW_VARIANTS: { key: ViewVariant; label: string; icon: React.ElementType }[] = [
  { key: "chips", label: "Chip Grid", icon: Grid3x3 },
  { key: "master", label: "Master + Override", icon: Layers },
];

// Fixture data — Dev Clone's 4 UCs, since it exercises mixed trigger types
// (polling, event-listener, event-listener, schedule) which stresses both variants.
const DEV_CLONE_UCS: UseCase[] = [
  {
    id: "uc_backlog_scan",
    title: "Hourly Backlog Scan",
    capability_summary: "Hourly codebase scan for backlog candidates.",
    suggested_trigger: {
      trigger_type: "polling",
      config: { cron: "0 * * * *", timezone: "local" },
      description: "Hourly polling.",
    },
    emits: [{ event_type: "dev-clone.backlog.candidate", description: "Per-finding." }],
  },
  {
    id: "uc_triage",
    title: "Triage Pipeline",
    capability_summary: "Human accept/reject per candidate.",
    suggested_trigger: {
      trigger_type: "event_listener",
      config: { event_type: "dev-clone.backlog.candidate" },
      description: "Event-listen.",
    },
    emits: [
      { event_type: "dev-clone.backlog.triaged", description: "Accept or reject." },
    ],
  },
  {
    id: "uc_implementation",
    title: "Implementation & PR Lifecycle",
    capability_summary: "Accepted → branch → diff → test → PR → review comment reactions.",
    suggested_trigger: {
      trigger_type: "event_listener",
      config: { event_type: "dev-clone.backlog.triaged" },
      description: "Event-listen on accepted triage.",
    },
    emits: [
      { event_type: "dev-clone.pr.created", description: "PR opened." },
      { event_type: "dev-clone.pr.updated", description: "Commit pushed." },
      { event_type: "dev-clone.pr.merged", description: "GitHub reports merge." },
    ],
  },
  {
    id: "uc_release_management",
    title: "Release Management",
    capability_summary: "Bundle merged PRs, draft notes, human-approve tag.",
    suggested_trigger: {
      trigger_type: "schedule",
      config: { cron: "0 17 * * 5", timezone: "local" },
      description: "Friday 5pm default.",
    },
    emits: [
      { event_type: "dev-clone.release.proposed", description: "Candidate drafted." },
      { event_type: "dev-clone.release.accepted", description: "Human approved + tagged." },
    ],
  },
];

export default function TriggerCompositionDemo() {
  const [activeVariant, setActiveVariant] = useState<ViewVariant>("chips");

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.06]">
        <div className="text-sm font-medium text-foreground">Trigger Composition — variant preview</div>
        <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-white/[0.02] p-1">
          {VIEW_VARIANTS.map((v) => {
            const VIcon = v.icon;
            return (
              <button
                key={v.key}
                onClick={() => setActiveVariant(v.key)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
                  activeVariant === v.key
                    ? "bg-white/[0.08] text-foreground shadow-sm"
                    : "text-muted-dark hover:text-foreground/70 hover:bg-white/[0.04]"
                }`}
              >
                <VIcon className="h-3.5 w-3.5" />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeVariant === "chips" ? (
        <TriggerCompositionStepChips
          personaName="Dev Clone"
          personaGoal="Act as a reliable extension of the lead developer — scan, triage, implement, review, release."
          triggerComposition="per_use_case"
          useCases={DEV_CLONE_UCS}
        />
      ) : (
        <TriggerCompositionStepMaster
          personaName="Dev Clone"
          personaGoal="Act as a reliable extension of the lead developer — scan, triage, implement, review, release."
          triggerComposition="per_use_case"
          useCases={DEV_CLONE_UCS}
        />
      )}
    </div>
  );
}
