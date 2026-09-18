import { Clock } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import type { CapabilityState } from "@/lib/types/buildTypes";
import { prettyTriggerType } from "@/features/shared/glyph/triggers";
import { humanizeCron } from "@/features/shared/glyph/cron";

/**
 * The capability row's Trigger pane - and the row's DEFAULT tab.
 *
 * It used to be the only read-only pane in the set: its siblings (Connectors,
 * Policies, Channels) all patch the capability, while this one rendered a
 * definition list and, before the build had proposed anything, the bare word
 * "pending". So the first thing a user saw when expanding a capability was the
 * one field they could not touch.
 *
 * Now it edits, through the same `patchCapability` door the siblings use, and
 * marks `resolvedFields.suggested_trigger` so the row's progress count reflects
 * a human answer the same way it reflects a build event's.
 */

interface Props {
  capability: CapabilityState;
}

type TriggerType = NonNullable<CapabilityState["suggested_trigger"]>["trigger_type"];

/** Offered in the order a user reaches for them; `prettyTriggerType` already
 *  localizes every one of these. */
const TRIGGER_TYPES: readonly TriggerType[] = ["schedule", "polling", "event", "webhook", "manual"];

function configString(cfg: Record<string, unknown>, key: string): string {
  const v = cfg[key];
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? v : String(v);
}

export function CapabilityTriggerPane({ capability }: Props) {
  const { t } = useTranslation();
  const patchCapability = useAgentStore((s) => s.patchCapability);
  const trig = capability.suggested_trigger ?? null;
  const cfg = trig?.config ?? {};

  /** One door for every edit: write the trigger AND record that a human
   *  resolved this field, so the row's counter cannot say "pending" about
   *  something the user just typed. */
  const patch = (next: NonNullable<CapabilityState["suggested_trigger"]>) => {
    patchCapability(capability.id, {
      suggested_trigger: next,
      resolvedFields: { ...capability.resolvedFields, suggested_trigger: "resolved" },
    });
  };

  const setType = (type: TriggerType) => {
    // Changing type keeps the description and the timezone (they survive any
    // type) and drops the schedule-shaped keys that would otherwise linger as
    // dead config on a polling trigger.
    const kept: Record<string, unknown> = {};
    const tz = configString(cfg, "timezone");
    if (tz) kept.timezone = tz;
    if (type === "schedule" && typeof cfg.cron === "string") kept.cron = cfg.cron;
    if (type === "polling" && cfg.interval_seconds != null) kept.interval_seconds = cfg.interval_seconds;
    patch({ trigger_type: type, config: kept, description: trig?.description ?? "" });
  };

  const setConfig = (key: string, value: unknown) => {
    const nextCfg = { ...cfg };
    if (value === "" || value === null || value === undefined) delete nextCfg[key];
    else nextCfg[key] = value;
    patch({
      trigger_type: trig?.trigger_type ?? "manual",
      config: nextCfg,
      description: trig?.description ?? "",
    });
  };

  const cron = configString(cfg, "cron");
  const cronPreview = trig?.trigger_type === "schedule" && cron ? humanizeCron(t, cron) : "";

  const inputClass =
    "rounded-xl border border-border/40 bg-background/60 px-3 py-2 typo-body-sm text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40";

  return (
    <div
      className="flex flex-col gap-4"
      data-testid={`capability-trigger-pane-${capability.id}`}
    >
      <section className="flex flex-col gap-2">
        <span
          id={`capability-trigger-type-label-${capability.id}`}
          className="typo-label text-foreground"
        >
          {t.matrix_v3.capability_trigger_type}
        </span>
        <div
          role="group"
          aria-labelledby={`capability-trigger-type-label-${capability.id}`}
          className="inline-flex flex-wrap gap-1 rounded-full bg-secondary/30 p-0.5"
        >
          {TRIGGER_TYPES.map((type) => (
            <button
              type="button"
              key={type}
              aria-pressed={trig?.trigger_type === type}
              onClick={() => setType(type)}
              data-testid={`capability-trigger-type-${type}-${capability.id}`}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 typo-body-sm transition ${
                trig?.trigger_type === type
                  ? "bg-primary/15 text-primary"
                  : "text-foreground hover:bg-secondary/50"
              }`}
            >
              {type === "schedule" ? <Clock className="h-3 w-3" /> : null}
              {prettyTriggerType(t, type)}
            </button>
          ))}
        </div>
        {!trig && (
          <p
            className="typo-body-sm text-foreground"
            data-testid={`capability-trigger-empty-${capability.id}`}
          >
            {t.matrix_v3.capability_trigger_none}
          </p>
        )}
      </section>

      {trig?.trigger_type === "schedule" && (
        <Field
          id={`capability-trigger-cron-${capability.id}`}
          label={t.matrix_v3.capability_trigger_cron}
          value={cron}
          placeholder="0 9 * * *"
          hint={cronPreview}
          inputClass={inputClass}
          onChange={(v) => setConfig("cron", v)}
        />
      )}

      {trig?.trigger_type === "polling" && (
        <Field
          id={`capability-trigger-interval-${capability.id}`}
          label={t.matrix_v3.capability_trigger_interval}
          value={configString(cfg, "interval_seconds")}
          placeholder="300"
          inputClass={inputClass}
          inputMode="numeric"
          onChange={(v) => {
            const n = Number(v);
            // A non-numeric keystroke clears the key rather than persisting a
            // string where the backend reads a number.
            setConfig("interval_seconds", v !== "" && Number.isFinite(n) ? n : "");
          }}
        />
      )}

      {trig && (
        <>
          <Field
            id={`capability-trigger-timezone-${capability.id}`}
            label={t.matrix_v3.capability_trigger_timezone}
            value={configString(cfg, "timezone")}
            placeholder="UTC"
            inputClass={inputClass}
            onChange={(v) => setConfig("timezone", v)}
          />
          <Field
            id={`capability-trigger-description-${capability.id}`}
            label={t.matrix_v3.capability_trigger_description}
            value={trig.description ?? ""}
            inputClass={inputClass}
            onChange={(v) =>
              patch({ trigger_type: trig.trigger_type, config: cfg, description: v })
            }
          />
        </>
      )}
    </div>
  );
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  hint?: string;
  inputClass: string;
  inputMode?: "numeric";
  onChange: (value: string) => void;
}

function Field({ id, label, value, placeholder, hint, inputClass, inputMode, onChange }: FieldProps) {
  return (
    <section className="flex flex-col gap-2">
      <label htmlFor={id} className="typo-label text-foreground">
        {label}
      </label>
      <input
        id={id}
        data-testid={id}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      />
      {hint ? <p className="typo-caption text-foreground">{hint}</p> : null}
    </section>
  );
}
