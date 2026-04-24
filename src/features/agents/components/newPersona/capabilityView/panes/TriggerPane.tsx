import { Clock } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { CapabilityState } from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

export function TriggerPane({ capability }: Props) {
  const { t } = useTranslation();
  const trig = capability.suggested_trigger;

  if (!trig) {
    return (
      <p
        className="typo-body-sm text-foreground/45 py-3"
        data-testid={`capability-trigger-empty-${capability.id}`}
      >
        {t.matrix_v3.capability_row_field_pending}
      </p>
    );
  }

  const cfg = (trig.config ?? {}) as Record<string, unknown>;
  const rows: Array<{ key: string; value: string }> = [];
  Object.entries(cfg).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "") return;
    rows.push({
      key: k,
      value: typeof v === "string" ? v : JSON.stringify(v),
    });
  });

  return (
    <div
      className="flex flex-col gap-3"
      data-testid={`capability-trigger-pane-${capability.id}`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/15 px-2.5 py-1 typo-caption font-medium text-primary">
          <Clock className="h-3 w-3" />
          {trig.trigger_type}
        </span>
        {trig.description ? (
          <span className="typo-body-sm text-foreground/70 truncate">
            {trig.description}
          </span>
        ) : null}
      </div>

      {rows.length > 0 ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border border-border/30 bg-background/40 px-3 py-2">
          {rows.map((row) => (
            <div key={row.key} className="contents">
              <dt className="typo-caption font-medium text-foreground/50">{row.key}</dt>
              <dd className="typo-body-sm text-foreground break-all">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}
