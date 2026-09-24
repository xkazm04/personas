import { FileText } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import type { CapabilityState } from "@/lib/types/buildTypes";

interface Props {
  capability: CapabilityState;
}

/**
 * The 5th gate's lane (`gates.rs` `sample_output`): which shape this
 * capability's output takes, and the reference example if one was attached.
 * The answer arrives through the build session's clarifying question
 * (`legacy_cell_to_v3_field` maps the `sample-output` cell key); this pane is
 * where the row shows what landed, so the progress bar and the gate agree.
 */
export function CapabilitySampleOutputPane({ capability }: Props) {
  const { t } = useTranslation();
  const sample = capability.sample_output ?? null;

  return (
    <div
      className="flex flex-col gap-2"
      data-testid={`capability-sample-output-pane-${capability.id}`}
    >
      <header className="flex items-center gap-2">
        <FileText className="h-3.5 w-3.5 text-foreground" />
        <h4 className="typo-label text-foreground">
          {t.matrix_v3.voice_output_format_label}
        </h4>
      </header>

      {sample?.format ? (
        <span
          className="w-fit rounded-card bg-secondary/25 px-2 py-1 typo-body text-foreground"
          data-testid={`capability-sample-output-format-${capability.id}`}
        >
          {sample.format}
        </span>
      ) : (
        <p className="typo-body text-foreground">
          {t.matrix_v3.capability_row_field_pending}
        </p>
      )}

      {sample?.example ? (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-card bg-secondary/25 px-2 py-1.5 typo-caption text-foreground">
          {sample.example}
        </pre>
      ) : null}
    </div>
  );
}
