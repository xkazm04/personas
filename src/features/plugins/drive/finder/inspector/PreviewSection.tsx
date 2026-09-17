import { Eye } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { useTranslation } from "@/i18n/useTranslation";
import { visualForEntry } from "../../designTokens";
import { useEntryMedia } from "../quicklook/useEntryMedia";
import { InspectorSection } from "./InspectorSection";

const INSPECTOR_TEXT_CHARS = 4000;

/** Delayed ghost in the preview box geometry — a fast read never paints it. */
function PreviewGhost() {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className="rounded-card border border-card-border bg-card-bg p-3 space-y-2">
      <span className="sr-only">{t.plugins.drive.loading}</span>
      {["w-full", "w-5/6", "w-2/3", "w-4/6"].map((w, i) => (
        <span
          key={w}
          className={`block h-3 ${w} rounded-pill bg-primary/[0.06] animate-fade-in`}
          style={{ animationDelay: `${120 + i * 35}ms` }}
        />
      ))}
    </div>
  );
}

/**
 * Inline preview for one file: an image (click → Quick Look), the first
 * 4000 chars of a text file, or a kind icon with an "Open Quick Look" button
 * for video / pdf / audio. Reuses the Quick Look media loader, so the
 * stale-read guard and the 256 KB text ceiling are the same in both places.
 */
export function PreviewSection({
  entry,
  onQuickLook,
}: {
  entry: DriveEntry;
  onQuickLook: (entry: DriveEntry) => void;
}) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  // Image + text load inline; the heavier kinds only offer the Quick Look door.
  const inline = (entry.mime ?? "").startsWith("image/") || entry.mime?.startsWith("text/") || entry.mime === "application/json";
  const media = useEntryMedia(inline ? entry : null);
  if (entry.kind !== "file") return null;

  let body: React.ReactNode;
  if (!inline) {
    const visual = visualForEntry(entry);
    const Icon = visual.Icon;
    body = (
      <div className="flex flex-col items-center gap-3 py-3">
        <div className={`w-16 h-16 rounded-card border border-card-border flex items-center justify-center bg-gradient-to-br ${visual.gradient}`}>
          <Icon className={`w-8 h-8 ${visual.text}`} />
        </div>
        <Button variant="secondary" size="sm" icon={<Eye className="w-3.5 h-3.5" />} onClick={() => onQuickLook(entry)}>
          {f.insp_preview_open}
        </Button>
      </div>
    );
  } else if (media.state === "loading") {
    body = <PreviewGhost />;
  } else if (media.state === "too_large") {
    body = <p className="typo-body text-foreground">{f.ql_too_large}</p>;
  } else if (media.state === "failed") {
    body = <p className="typo-body text-foreground">{t.plugins.drive.preview_unavailable}</p>;
  } else if (media.kind === "image" && media.url) {
    body = (
      <button
        type="button"
        onClick={() => onQuickLook(entry)}
        aria-label={f.insp_preview_open}
        title={f.insp_preview_open}
        className="block w-full rounded-card border border-card-border bg-card-bg p-1 overflow-hidden hover:border-primary/40 transition-colors cursor-zoom-in focus-ring"
      >
        <img src={media.url} alt={entry.name} className="rounded-input max-w-full max-h-56 object-contain mx-auto" />
      </button>
    );
  } else {
    body = (
      <pre className="max-h-72 overflow-auto rounded-card border border-card-border bg-card-bg p-3 typo-code text-foreground whitespace-pre-wrap break-words">
        {(media.text ?? "").slice(0, INSPECTOR_TEXT_CHARS)}
      </pre>
    );
  }

  return (
    <InspectorSection title={f.insp_preview} testId="inspector-preview">
      {body}
    </InspectorSection>
  );
}
