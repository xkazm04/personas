import { AlertTriangle, CalendarClock, KeyRound, Wrench, Zap } from "lucide-react";

import { useTranslation } from "@/i18n/useTranslation";
import { useFormattedDate } from "@/hooks/utility/data/useFormattedDate";
import type { PromoteFireView, PromoteView } from "./promotePreviewModel";

interface GlyphPromotePreviewProps {
  view: PromoteView;
}

/**
 * What promote will arm, repair and refuse, shown above the Promote button.
 * Every figure comes from the backend's read-only promote preview, which runs
 * the same preparation promote runs. Renders nothing while the preview is
 * loading or when there is nothing to say, so the approval card never waits
 * on it.
 */
export function GlyphPromotePreview({ view }: GlyphPromotePreviewProps) {
  const { t, tx } = useTranslation();
  const copy = t.agents.promote_preview;
  if (!view.hasContent) return null;

  if (!view.canPromote) {
    return (
      <div
        role="alert"
        data-testid="glyph-promote-refusal"
        className="w-full rounded-card border border-status-error/30 bg-status-error/10 px-3 py-2 flex gap-2 text-left"
      >
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-status-error" />
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="typo-label text-status-error">{copy.refused}</span>
          {view.reason && <p className="typo-caption text-foreground break-words">{view.reason}</p>}
          <p className="typo-caption text-foreground">{copy.refused_hint}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="glyph-promote-preview"
      className="w-full rounded-card border border-card-border bg-secondary/30 px-3 py-2 flex flex-col gap-1.5 text-left"
    >
      <span className="typo-label text-foreground">{copy.heading}</span>
      {view.fires.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {view.fires.map((fire, i) => (
            <FireRow key={`${fire.triggerType}-${i}`} fire={fire} />
          ))}
        </ul>
      )}
      {view.needsSetup.length > 0 && (
        <p className="typo-caption text-status-warning flex items-center gap-1.5">
          <KeyRound className="w-3.5 h-3.5 shrink-0" />
          {tx(copy.needs_setup, { connectors: view.needsSetup.join(", ") })}
        </p>
      )}
      {view.repairs.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <span className="typo-caption text-foreground flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 shrink-0" />
            {copy.repaired}
          </span>
          <ul className="pl-5 flex flex-col gap-0.5">
            {view.repairs.map((note) => (
              <li key={note} className="typo-caption text-foreground break-words list-disc">
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function FireRow({ fire }: { fire: PromoteFireView }) {
  const { t, tx } = useTranslation();
  const copy = t.agents.promote_preview;
  const when = useFormattedDate(fire.nextFireAt, { dateStyle: "medium", timeStyle: "short" });
  const label = fire.nextFireAt && when
    ? tx(copy.runs_next, { type: fire.triggerType, time: when })
    : fire.triggerType === "manual"
      ? copy.runs_manual
      : tx(copy.runs_on_event, { type: fire.triggerType });
  const Icon = fire.nextFireAt ? CalendarClock : Zap;
  return (
    <li className="typo-caption text-foreground flex items-center gap-1.5">
      <Icon className="w-3.5 h-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        {label}
        {fire.description ? ` · ${fire.description}` : ""}
      </span>
    </li>
  );
}
