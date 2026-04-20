/**
 * Trigger Composition step parent. Hosts both variants behind a tab
 * switcher so A/B comparison is possible on real template data. Insert
 * between UseCasePickerStep and QuestionnaireFormFocus in the adoption
 * flow. Once one variant wins, delete the tab switcher + the rejected
 * variant and promote the winner to a plain step component.
 */

import { useState, type ElementType } from "react";
import { Grid3x3, Layers } from "lucide-react";
import TriggerCompositionStepChips from "./TriggerCompositionStepChips";
import TriggerCompositionStepMaster from "./TriggerCompositionStepMaster";
import type { UseCase, TriggerSelection } from "./TriggerCompositionStepChips";

type ViewVariant = "chips" | "master";

const VIEW_VARIANTS: { key: ViewVariant; label: string; icon: ElementType }[] = [
  { key: "chips", label: "Chip Grid", icon: Grid3x3 },
  { key: "master", label: "Master + Override", icon: Layers },
];

export interface TriggerCompositionDemoProps {
  personaName: string;
  personaGoal?: string | null;
  /** Persona-level composition from the template. */
  triggerComposition: "shared" | "per_use_case";
  useCases: UseCase[];
  /** Continue to the next step (questionnaire). */
  onContinue: (selections: {
    perUseCase: Record<string, TriggerSelection>;
    master?: TriggerSelection;
    overrides?: Record<string, TriggerSelection>;
    variant: ViewVariant;
  }) => void;
  /** Back to the UC picker. */
  onBack?: () => void;
}

// Fixture data — Dev Clone's 4 UCs, retained for isolated prototyping.
// Not used when TriggerCompositionDemo is mounted with real props.
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

export default function TriggerCompositionDemo({
  personaName,
  personaGoal,
  triggerComposition,
  useCases,
  onContinue,
  onBack,
}: TriggerCompositionDemoProps) {
  const [activeVariant, setActiveVariant] = useState<ViewVariant>("chips");
  // Captured selections from each variant; the winner's selections ship with
  // onContinue when the user clicks the button. Both are stored so switching
  // tabs doesn't wipe the user's work.
  const [perUseCase, setPerUseCase] = useState<Record<string, TriggerSelection>>({});
  const [master, setMaster] = useState<TriggerSelection | undefined>(undefined);
  const [overrides, setOverrides] = useState<Record<string, TriggerSelection>>({});

  const handleContinue = () => {
    onContinue({
      perUseCase,
      master,
      overrides,
      variant: activeVariant,
    });
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex items-center justify-between px-6 py-3 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              onClick={onBack}
              className="typo-caption text-muted-dark hover:text-foreground underline underline-offset-2"
            >
              ← Back
            </button>
          )}
          <div className="text-sm font-medium text-foreground">Trigger Composition</div>
        </div>
        <div className="flex items-center gap-3">
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
          <button
            onClick={handleContinue}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card bg-primary/20 hover:bg-primary/30 border border-primary/30 typo-caption font-medium text-foreground transition-colors"
          >
            Continue →
          </button>
        </div>
      </div>

      {activeVariant === "chips" ? (
        <TriggerCompositionStepChips
          personaName={personaName}
          personaGoal={personaGoal ?? undefined}
          triggerComposition={triggerComposition}
          useCases={useCases}
          onChange={setPerUseCase}
        />
      ) : (
        <TriggerCompositionStepMaster
          personaName={personaName}
          personaGoal={personaGoal ?? undefined}
          triggerComposition={triggerComposition}
          useCases={useCases}
          onChange={(m, o) => {
            setMaster(m);
            setOverrides(o);
          }}
        />
      )}
    </div>
  );
}

/**
 * Isolated preview with Dev Clone fixture data — retained for local
 * visual checks. Not part of the production adoption flow.
 */
export function TriggerCompositionDemoFixture() {
  return (
    <TriggerCompositionDemo
      personaName="Dev Clone"
      personaGoal="Act as a reliable extension of the lead developer — scan, triage, implement, review, release."
      triggerComposition="per_use_case"
      useCases={DEV_CLONE_UCS}
      onContinue={() => undefined}
    />
  );
}
