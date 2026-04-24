import { useState } from "react";
import { useTranslation } from "@/i18n/useTranslation";
import { useAgentStore } from "@/stores/agentStore";
import type { CapabilityState } from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

export function ConnectorsPane({ capability }: Props) {
  const { t } = useTranslation();
  const patchCapability = useAgentStore((s) => s.patchCapability);
  const [draft, setDraft] = useState("");
  const value = capability.connectors ?? [];

  const update = (next: string[]) =>
    patchCapability(capability.id, { connectors: next });

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed || value.includes(trimmed)) {
      setDraft("");
      return;
    }
    update([...value, trimmed]);
    setDraft("");
  };

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`capability-connectors-pane-${capability.id}`}
    >
      <label className="typo-label text-foreground/70">
        {t.matrix_v3.capability_row_field_connectors}
      </label>
      <div className="flex flex-wrap gap-2">
        {value.length === 0 ? (
          <span className="typo-body-sm text-foreground/40">
            {t.matrix_v3.capability_row_field_pending}
          </span>
        ) : null}
        {value.map((c, i) => (
          <span
            key={`${c}-${i}`}
            className="inline-flex items-center gap-1 rounded-full bg-secondary/40 px-3 py-1 typo-body-sm text-foreground"
          >
            {c}
            <button
              type="button"
              onClick={() => update(value.filter((_, idx) => idx !== i))}
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
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="connector_name"
          className="min-w-[140px] flex-1 rounded-full border border-border/40 bg-transparent px-3 py-1 typo-body-sm text-foreground placeholder:text-foreground/30 focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
      </div>
    </div>
  );
}
