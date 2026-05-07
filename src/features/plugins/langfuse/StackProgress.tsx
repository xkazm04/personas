import { useTranslation } from "@/i18n/useTranslation";
import type { LangfuseJobKind } from "@/lib/bindings/LangfuseJobKind";
import type { StartPhase } from "@/lib/bindings/StartPhase";

interface StackProgressProps {
  jobKind: LangfuseJobKind;
  fraction: number;
  etaSeconds: number;
  message: string;
}

export function StackProgress({ jobKind, fraction, etaSeconds, message }: StackProgressProps) {
  const { t, tx } = useTranslation();

  const pct = Math.max(0, Math.min(100, Math.round(fraction * 100)));
  const etaText =
    etaSeconds > 60
      ? tx(t.plugins.langfuse.eta_label_minutes, { minutes: Math.round(etaSeconds / 60) })
      : etaSeconds > 0
      ? tx(t.plugins.langfuse.eta_label, { seconds: etaSeconds })
      : "";

  const accent = jobKindAccent(jobKind);

  return (
    <div className="space-y-2 p-3 rounded-card border border-primary/10 bg-secondary/10">
      <div className="flex items-center justify-between gap-3">
        <span className="typo-body text-foreground truncate">{message}</span>
        <span className="typo-caption text-foreground/80 flex-shrink-0">{pct}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
        <div
          className={`h-full ${accent.bar} transition-all duration-500 ease-out`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex items-center justify-between gap-3 typo-caption text-foreground/80">
        <span>{etaText}</span>
        <span>{t.plugins.langfuse.background_hint}</span>
      </div>
    </div>
  );
}

function jobKindAccent(kind: LangfuseJobKind) {
  switch (kind) {
    case "start":
      return { bar: "bg-emerald-400" };
    case "stop":
      return { bar: "bg-amber-400" };
    case "installerDownload":
      return { bar: "bg-indigo-400" };
    default:
      return { bar: "bg-primary" };
  }
}

export function phaseLabel(
  phase: StartPhase | null | undefined,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  switch (phase) {
    case "preparing":
      return t.plugins.langfuse.phase_preparing;
    case "pullingImages":
      return t.plugins.langfuse.phase_pulling_images;
    case "startingContainers":
      return t.plugins.langfuse.phase_starting_containers;
    case "healthchecking":
      return t.plugins.langfuse.phase_healthchecking;
    default:
      return "";
  }
}
