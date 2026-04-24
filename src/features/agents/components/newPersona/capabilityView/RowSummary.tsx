import { Clock, ShieldCheck } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { CapabilityState } from "@/lib/types/buildTypes";
import { Chip } from "./Chip";
import { isResolved, resolutionProgress, triggerSummary } from "./helpers";

interface Props {
  capability: CapabilityState;
}

export function RowSummary({ capability }: Props) {
  const { t } = useTranslation();
  const { resolved, total } = resolutionProgress(capability);
  const pct = total > 0 ? Math.round((resolved / total) * 100) : 0;
  const reviewMode = capability.review_policy?.mode;

  const reviewLabel =
    reviewMode === "always"
      ? t.matrix_v3.review_mode_always
      : reviewMode === "on_low_confidence"
        ? t.matrix_v3.review_mode_on_low_confidence
        : t.matrix_v3.review_mode_never;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex items-center gap-2 rounded-full bg-secondary/30 px-2.5 py-1"
        data-testid={`capability-progress-${capability.id}`}
      >
        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-background/60">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="typo-caption font-medium text-foreground/70">
          {resolved}/{total}
        </span>
      </div>

      <Chip
        icon={<Clock className="h-3 w-3" />}
        label={t.matrix_v3.capability_row_field_trigger}
        value={triggerSummary(capability)}
        resolved={isResolved(capability, "suggested_trigger")}
        placeholder={t.matrix_v3.capability_row_field_pending}
        testId={`capability-chip-trigger-${capability.id}`}
        tone="primary"
      />
      <Chip
        icon={<ShieldCheck className="h-3 w-3" />}
        label={t.matrix_v3.capability_row_field_review}
        value={reviewMode ? reviewLabel : ""}
        resolved={isResolved(capability, "review_policy")}
        placeholder={t.matrix_v3.capability_row_field_pending}
        testId={`capability-chip-review-${capability.id}`}
      />
    </div>
  );
}
