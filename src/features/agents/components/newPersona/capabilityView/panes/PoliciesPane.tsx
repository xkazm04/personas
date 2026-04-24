import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import type {
  CapabilityState,
  MemoryPolicy,
  ReviewPolicy,
} from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

const REVIEW_MODES = ["never", "on_low_confidence", "always"] as const;

export function PoliciesPane({ capability }: Props) {
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
        <label className="typo-label text-foreground/70">
          {t.matrix_v3.capability_row_field_review}
        </label>
        <div className="inline-flex rounded-full bg-secondary/30 p-0.5">
          {REVIEW_MODES.map((m) => (
            <button
              type="button"
              key={m}
              onClick={() => onReview({ ...review, mode: m })}
              className={`rounded-full px-3 py-1 typo-body-sm transition ${
                review.mode === m
                  ? "bg-primary/25 text-primary"
                  : "text-foreground/60 hover:text-foreground"
              }`}
            >
              {reviewLabel(m)}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={review.context}
          onChange={(e) => onReview({ ...review, context: e.target.value })}
          placeholder="Context"
          className={inputClass}
        />
      </section>

      <section className="flex flex-col gap-2">
        <label className="typo-label text-foreground/70">
          {t.matrix_v3.capability_row_field_memory}
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={memory.enabled}
            onClick={() => onMemory({ ...memory, enabled: !memory.enabled })}
            className={`relative h-6 w-11 rounded-full transition ${
              memory.enabled ? "bg-primary/60" : "bg-secondary/50"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-foreground shadow transition-all ${
                memory.enabled ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
          <span className="typo-body-sm text-foreground/70">
            {memory.enabled
              ? t.matrix_v3.memory_enabled_true
              : t.matrix_v3.memory_enabled_false}
          </span>
        </div>
        <input
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
