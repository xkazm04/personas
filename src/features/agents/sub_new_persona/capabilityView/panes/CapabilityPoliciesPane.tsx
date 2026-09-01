import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import { AccessibleToggle } from "@/features/shared/components/forms/AccessibleToggle";
import type {
  CapabilityState,
  MemoryPolicy,
  ReviewPolicy,
} from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

const REVIEW_MODES = ["never", "on_low_confidence", "always"] as const;

export function CapabilityPoliciesPane({ capability }: Props) {
  const { t } = useTranslation();
  const patchCapability = useAgentStore((s) => s.patchCapability);

  const review: ReviewPolicy = capability.review_policy ?? { mode: "never", context: "" };
  const memory: MemoryPolicy = capability.memory_policy ?? { enabled: false, context: "" };

  const onReview = (v: ReviewPolicy) => patchCapability(capability.id, { review_policy: v });
  const onMemory = (v: MemoryPolicy) => patchCapability(capability.id, { memory_policy: v });

  const reviewLabel = (m: (typeof REVIEW_MODES)[number]) =>
    m === "always"
      ? t.matrix_v3.review_mode_always
      : m === "on_low_confidence"
        ? t.matrix_v3.review_mode_on_low_confidence
        : t.matrix_v3.review_mode_never;

  const inputClass =
    "rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={`capability-policies-pane-${capability.id}`}
    >
      <section className="flex flex-col gap-2">
        <label
          id={`capability-review-label-${capability.id}`}
          htmlFor={`capability-review-context-${capability.id}`}
          className="typo-label text-foreground"
        >
          {t.matrix_v3.capability_row_field_review}
        </label>
        <div
          role="group"
          aria-labelledby={`capability-review-label-${capability.id}`}
          className="inline-flex rounded-full bg-secondary/30 p-0.5"
        >
          {REVIEW_MODES.map((m) => (
            <button
              type="button"
              key={m}
              aria-pressed={review.mode === m}
              onClick={() => onReview({ ...review, mode: m })}
              className={`rounded-full px-3 py-1 typo-body-sm transition ${
                review.mode === m
                  ? "bg-primary/25 text-primary"
                  : "text-foreground hover:text-foreground"
              }`}
            >
              {reviewLabel(m)}
            </button>
          ))}
        </div>
        <input
          id={`capability-review-context-${capability.id}`}
          type="text"
          value={review.context}
          onChange={(e) => onReview({ ...review, context: e.target.value })}
          placeholder="Context"
          className={inputClass}
        />
      </section>

      <section className="flex flex-col gap-2">
        <label
          htmlFor={`capability-memory-context-${capability.id}`}
          className="typo-label text-foreground"
        >
          {t.matrix_v3.capability_row_field_memory}
        </label>
        <div className="flex items-center gap-2">
          <AccessibleToggle
            checked={memory.enabled}
            onChange={() => onMemory({ ...memory, enabled: !memory.enabled })}
            label={t.matrix_v3.capability_row_field_memory}
            size="sm"
            data-testid={`capability-memory-toggle-${capability.id}`}
          />
          <span className="typo-body-sm text-foreground">
            {memory.enabled
              ? t.matrix_v3.memory_enabled_true
              : t.matrix_v3.memory_enabled_false}
          </span>
        </div>
        <input
          id={`capability-memory-context-${capability.id}`}
          type="text"
          value={memory.context}
          onChange={(e) => onMemory({ ...memory, context: e.target.value })}
          placeholder="Context"
          className={inputClass}
        />
      </section>
    </div>
  );
}
