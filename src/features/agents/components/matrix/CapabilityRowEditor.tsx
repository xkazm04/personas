/**
 * CapabilityRowEditor -- one row in the v3 capability list.
 *
 * Collapsed: title + summary + resolution chips (trigger / connectors /
 * channels / review / memory / events). Expanded: editable fields per §3.4
 * of docs/concepts/persona-capabilities/C4-build-from-scratch-v3-handoff.md.
 *
 * Editing here flows through `patchCapability` on the store; no IPC here.
 * Refine-time conversation with the CLI happens through
 * `useMatrixLifecycle.handleRefine` separately.
 */

import { useState, useCallback } from "react";
import { ChevronDown, ChevronRight, Trash2, Clock, Plug, Bell, ShieldCheck, Brain, Radio } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import type {
  CapabilityState,
  ReviewPolicy,
  MemoryPolicy,
} from "@/lib/types/buildTypes";

interface Props {
  capabilityId: string;
}

function triggerSummary(cap: CapabilityState): string {
  if (!cap.suggested_trigger) return "";
  const t = cap.suggested_trigger;
  const cfg = t.config ?? {};
  const cron = (cfg as Record<string, unknown>).cron;
  const interval = (cfg as Record<string, unknown>).interval;
  if (t.trigger_type === "schedule" || t.trigger_type === "polling") {
    return String(cron ?? interval ?? t.trigger_type);
  }
  return t.description ?? t.trigger_type;
}

export function CapabilityRowEditor({ capabilityId }: Props) {
  const { t } = useTranslation();
  const cap = useAgentStore((s) => s.buildCapabilities[capabilityId]);
  const patchCapability = useAgentStore((s) => s.patchCapability);
  const removeCapability = useAgentStore((s) => s.removeCapability);
  const [expanded, setExpanded] = useState(false);

  const toggleExpand = useCallback(() => setExpanded((p) => !p), []);

  if (!cap) return null;

  const fieldResolved = (field: string) => cap.resolvedFields[field] === "resolved";
  const reviewMode = cap.review_policy?.mode;
  const reviewLabel =
    reviewMode === "always"
      ? t.matrix_v3.review_mode_always
      : reviewMode === "on_low_confidence"
        ? t.matrix_v3.review_mode_on_low_confidence
        : t.matrix_v3.review_mode_never;

  return (
    <article
      className="rounded-2xl border border-border/30 bg-background/40"
      data-testid={`capability-row-${capabilityId}`}
      data-capability-id={capabilityId}
    >
      {/* Collapsed / summary row */}
      <header className="flex items-start gap-3 p-4">
        <button
          type="button"
          onClick={toggleExpand}
          className="mt-1 rounded-full p-1 text-foreground/60 hover:bg-secondary/40 hover:text-foreground"
          aria-label={expanded ? t.matrix_v3.capability_row_collapse : t.matrix_v3.capability_row_expand}
          data-testid={`capability-row-toggle-${capabilityId}`}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex-1 min-w-0">
          <input
            type="text"
            value={cap.title}
            onChange={(e) => patchCapability(capabilityId, { title: e.target.value })}
            className="w-full border-none bg-transparent typo-heading-xs text-foreground focus:outline-none"
            data-testid={`capability-title-${capabilityId}`}
          />
          <input
            type="text"
            value={cap.capability_summary}
            onChange={(e) => patchCapability(capabilityId, { capability_summary: e.target.value })}
            className="mt-1 w-full border-none bg-transparent typo-body-sm text-foreground/60 focus:outline-none"
            data-testid={`capability-summary-${capabilityId}`}
          />

          {/* Inline resolution chips */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Chip
              icon={<Clock className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_trigger}
              value={triggerSummary(cap)}
              resolved={fieldResolved("suggested_trigger")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-trigger-${capabilityId}`}
            />
            <Chip
              icon={<Plug className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_connectors}
              value={(cap.connectors ?? []).join(", ")}
              resolved={fieldResolved("connectors")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-connectors-${capabilityId}`}
            />
            <Chip
              icon={<Bell className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_channels}
              value={(cap.notification_channels ?? [])
                .map((c) => `${c.channel}:${c.target}`)
                .join(", ")}
              resolved={fieldResolved("notification_channels")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-channels-${capabilityId}`}
            />
            <Chip
              icon={<ShieldCheck className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_review}
              value={reviewMode ? reviewLabel : ""}
              resolved={fieldResolved("review_policy")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-review-${capabilityId}`}
            />
            <Chip
              icon={<Brain className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_memory}
              value={
                cap.memory_policy
                  ? cap.memory_policy.enabled
                    ? t.matrix_v3.memory_enabled_true
                    : t.matrix_v3.memory_enabled_false
                  : ""
              }
              resolved={fieldResolved("memory_policy")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-memory-${capabilityId}`}
            />
            <Chip
              icon={<Radio className="h-3 w-3" />}
              label={t.matrix_v3.capability_row_field_events}
              value={String(cap.event_subscriptions?.length ?? 0)}
              resolved={fieldResolved("event_subscriptions")}
              placeholderLabel={t.matrix_v3.capability_row_field_pending}
              testId={`capability-chip-events-${capabilityId}`}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => removeCapability(capabilityId)}
          className="rounded-full p-1.5 text-foreground/40 hover:bg-red-500/10 hover:text-red-500"
          aria-label={t.matrix_v3.capability_row_remove}
          data-testid={`capability-row-remove-${capabilityId}`}
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </header>

      {/* Expanded detail */}
      {expanded ? (
        <div
          className="flex flex-col gap-4 border-t border-border/20 p-4"
          data-testid={`capability-row-detail-${capabilityId}`}
        >
          <ReviewPolicyEditor
            value={cap.review_policy}
            onChange={(v) => patchCapability(capabilityId, { review_policy: v })}
          />
          <MemoryPolicyEditor
            value={cap.memory_policy}
            onChange={(v) => patchCapability(capabilityId, { memory_policy: v })}
          />
          <ConnectorListEditor
            value={cap.connectors ?? []}
            onChange={(v) => patchCapability(capabilityId, { connectors: v })}
          />
          <TriggerSummaryReadOnly
            value={cap.suggested_trigger}
            labelTrigger={t.matrix_v3.capability_row_field_trigger}
          />
        </div>
      ) : null}
    </article>
  );
}

interface ChipProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  resolved: boolean;
  placeholderLabel: string;
  testId: string;
}

function Chip({ icon, label, value, resolved, placeholderLabel, testId }: ChipProps) {
  const displayValue = value || placeholderLabel;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 typo-caption ${
        resolved
          ? "bg-secondary/50 text-foreground"
          : "bg-secondary/20 text-foreground/40"
      }`}
      data-testid={testId}
      data-resolved={resolved}
    >
      {icon}
      <span className="font-medium">{label}</span>
      {displayValue ? <span className="truncate max-w-[160px]">· {displayValue}</span> : null}
    </span>
  );
}

interface ReviewPolicyEditorProps {
  value: ReviewPolicy | undefined;
  onChange: (v: ReviewPolicy) => void;
}

function ReviewPolicyEditor({ value, onChange }: ReviewPolicyEditorProps) {
  const { t } = useTranslation();
  const mode = value?.mode ?? "never";
  const context = value?.context ?? "";
  return (
    <div className="flex flex-col gap-2">
      <label className="typo-label text-foreground/80">
        {t.matrix_v3.capability_row_field_review}
      </label>
      <div className="flex flex-wrap gap-2">
        {(["never", "on_low_confidence", "always"] as const).map((m) => {
          const label =
            m === "always"
              ? t.matrix_v3.review_mode_always
              : m === "on_low_confidence"
                ? t.matrix_v3.review_mode_on_low_confidence
                : t.matrix_v3.review_mode_never;
          return (
            <button
              type="button"
              key={m}
              onClick={() => onChange({ mode: m, context })}
              className={`rounded-full px-3 py-1 typo-body-sm transition ${
                mode === m
                  ? "bg-primary/20 text-primary"
                  : "bg-secondary/30 text-foreground/60 hover:bg-secondary/50"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <input
        type="text"
        value={context}
        onChange={(e) => onChange({ mode, context: e.target.value })}
        placeholder="Context"
        className="rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
      />
    </div>
  );
}

interface MemoryPolicyEditorProps {
  value: MemoryPolicy | undefined;
  onChange: (v: MemoryPolicy) => void;
}

function MemoryPolicyEditor({ value, onChange }: MemoryPolicyEditorProps) {
  const { t } = useTranslation();
  const enabled = value?.enabled ?? false;
  const context = value?.context ?? "";
  return (
    <div className="flex flex-col gap-2">
      <label className="typo-label text-foreground/80">
        {t.matrix_v3.capability_row_field_memory}
      </label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange({ enabled: !enabled, context })}
          className={`rounded-full px-3 py-1 typo-body-sm transition ${
            enabled
              ? "bg-primary/20 text-primary"
              : "bg-secondary/30 text-foreground/60 hover:bg-secondary/50"
          }`}
        >
          {enabled ? t.matrix_v3.memory_enabled_true : t.matrix_v3.memory_enabled_false}
        </button>
        <input
          type="text"
          value={context}
          onChange={(e) => onChange({ enabled, context: e.target.value })}
          placeholder="Context"
          className="flex-1 rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/40"
        />
      </div>
    </div>
  );
}

interface ConnectorListEditorProps {
  value: string[];
  onChange: (v: string[]) => void;
}

function ConnectorListEditor({ value, onChange }: ConnectorListEditorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  return (
    <div className="flex flex-col gap-2">
      <label className="typo-label text-foreground/80">
        {t.matrix_v3.capability_row_field_connectors}
      </label>
      <div className="flex flex-wrap gap-2">
        {value.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/40 px-3 py-1 typo-body-sm text-foreground"
          >
            {c}
            <button
              type="button"
              onClick={() => onChange(value.filter((_, idx) => idx !== i))}
              className="text-foreground/50 hover:text-foreground"
              aria-label="Remove"
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && draft.trim()) {
              e.preventDefault();
              onChange([...value, draft.trim()]);
              setDraft("");
            }
          }}
          placeholder="connector_name"
          className="min-w-[140px] flex-1 rounded-full border border-border/40 bg-transparent px-3 py-1 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}

interface TriggerSummaryReadOnlyProps {
  value: CapabilityState["suggested_trigger"];
  labelTrigger: string;
}

function TriggerSummaryReadOnly({ value, labelTrigger }: TriggerSummaryReadOnlyProps) {
  if (!value) return null;
  return (
    <div className="flex flex-col gap-1">
      <label className="typo-label text-foreground/80">{labelTrigger}</label>
      <pre className="whitespace-pre-wrap rounded-xl border border-border/30 bg-background/40 p-3 typo-mono text-foreground/70">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
