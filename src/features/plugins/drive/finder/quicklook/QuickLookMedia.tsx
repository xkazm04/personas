import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { useReducedMotion } from "@/hooks/utility/interaction/useMotion";
import { visualForEntry } from "../../designTokens";
import type { EntryMedia } from "./useEntryMedia";
import type { Transform } from "./useQuickLookTransform";

interface Props {
  entry: DriveEntry;
  media: EntryMedia;
  transform: Transform;
  dragging: boolean;
  onImageLoad?: (w: number, h: number) => void;
}

/** Calm delayed ghost (never a spinner) in the media stage's geometry. */
function MediaGhost() {
  const { t } = useTranslation();
  return (
    <div
      aria-hidden="true"
      className="w-full max-w-2xl h-[60vh] max-h-[560px] rounded-card bg-primary/[0.06] animate-fade-in"
      style={{ animationDelay: "120ms" }}
    >
      <span className="sr-only">{t.plugins.drive.loading}</span>
    </div>
  );
}

function Notice({ text }: { text: string }) {
  return (
    <div className="max-w-md text-center typo-body text-foreground px-6 py-8 rounded-card border border-card-border bg-card-bg">
      {text}
    </div>
  );
}

/** Renders the current entry by `previewKind`; every branch stays inside the stage. */
export function QuickLookMedia({ entry, media, transform, dragging, onImageLoad }: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const reduceMotion = useReducedMotion();
  const { kind, state } = media;

  if (kind === null) {
    const visual = visualForEntry(entry);
    const Icon = visual.Icon;
    return (
      <div className="flex flex-col items-center gap-4">
        <div className="w-24 h-24 rounded-card border border-card-border bg-card-bg flex items-center justify-center">
          <Icon className={`w-12 h-12 ${visual.text}`} />
        </div>
        <Notice text={f.ql_unsupported} />
      </div>
    );
  }
  if (state === "loading") return <MediaGhost />;
  if (state === "too_large") return <Notice text={f.ql_too_large} />;
  if (state === "failed") return <Notice text={t.plugins.drive.finder.ql_failed} />;

  if (kind === "text") {
    return (
      <div className="w-full h-full min-h-0 flex flex-col gap-2">
        <pre className="flex-1 min-h-0 overflow-auto rounded-card border border-card-border bg-card-bg p-4 typo-code text-foreground whitespace-pre-wrap break-words">
          {media.text ?? ""}
        </pre>
        {media.truncated && (
          <div className="typo-caption text-foreground text-center">{f.ql_text_truncated}</div>
        )}
      </div>
    );
  }

  const url = media.url ?? "";
  if (kind === "image") {
    return (
      <img
        src={url}
        alt={entry.name}
        draggable={false}
        onLoad={(e) => onImageLoad?.(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight)}
        style={{
          transform: `translate(${transform.panX}px, ${transform.panY}px) scale(${transform.zoom}) rotate(${transform.rotation}deg)`,
          transition: dragging || reduceMotion ? "none" : "transform 120ms ease-out",
        }}
        className="max-w-full max-h-full object-contain rounded-card shadow-elevation-3 will-change-transform"
      />
    );
  }
  if (kind === "video") {
    // key forces a remount on entry change so stale buffers never linger.
    return (
      <video
        key={entry.path}
        src={url}
        controls
        autoPlay
        className="max-w-full max-h-full rounded-card shadow-elevation-3 bg-background"
      />
    );
  }
  if (kind === "audio") {
    const visual = visualForEntry(entry);
    const Icon = visual.Icon;
    return (
      <div className="flex flex-col items-center gap-6 w-full max-w-lg">
        <div className="w-24 h-24 rounded-card border border-card-border bg-card-bg flex items-center justify-center">
          <Icon className={`w-12 h-12 ${visual.text}`} />
        </div>
        <audio key={entry.path} src={url} controls className="w-full" />
      </div>
    );
  }
  // pdf — sandbox blocks scripts / forms / popups; allow-same-origin lets the
  // renderer load its assets relative to the blob URL.
  return (
    <iframe
      key={entry.path}
      src={url}
      title={entry.name}
      className="w-full h-full bg-secondary/30 rounded-card shadow-elevation-3"
      sandbox="allow-same-origin"
    />
  );
}
