import { useEffect, useState } from "react";
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import {
  Copy,
  ExternalLink,
  FileSignature,
  FileText,
  FolderOpen,
  Info,
  Play,
  ScanLine,
  ShieldCheck,
} from "lucide-react";

import { driveFormatBytes, driveReadText, type DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import { copyText } from '@/hooks/utility/interaction/useCopyToClipboard';
import { isOcrEligible } from "../ocr/useOcr";
import {
  formatRelativeTime,
  kindBucketWeight,
  kindGroupLabel,
  kindLabel,
  visualForEntry,
} from "../designTokens";

const VIDEO_MIME_PREFIX = "video/";
const PDF_MIME = "application/pdf";

interface Props {
  entries: DriveEntry[];
  currentPath: string;
  onPreviewClick?: (entry: DriveEntry) => void;
  // Single-entry quick actions — mirror the right-click context menu so the
  // details pane can act on the selected file without a context menu. All
  // optional; the action row renders only the buttons that are wired.
  onOpen?: (entry: DriveEntry) => void;
  onReveal?: (entry: DriveEntry) => void;
  onSign?: (entry: DriveEntry) => void;
  onVerify?: (entry: DriveEntry) => void;
  onExtractText?: (entry: DriveEntry) => void;
  hasGemini?: boolean;
  // Drive-relative paths that carry a signature record — used to badge a
  // signed file in the hero.
  signedPaths?: Set<string>;
}

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024; // 256 KB
const IMAGE_MIME_PREFIX = "image/";

export function DriveDetailsPane({
  entries,
  currentPath,
  onPreviewClick,
  onOpen,
  onReveal,
  onSign,
  onVerify,
  onExtractText,
  hasGemini = false,
  signedPaths,
}: Props) {
  const { t, tx } = useTranslation();
  const primary = entries[0] ?? null;
  const multi = entries.length > 1;

  if (!primary) {
    return (
      <aside className="w-72 flex-shrink-0 border-l border-primary/10 bg-gradient-to-b from-background to-background/80 px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-300" />
          <span className="typo-section-title">
            {t.plugins.drive.details_title}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500/20 to-sky-500/5 border border-cyan-500/30 flex items-center justify-center mb-3">
              <Info className="w-7 h-7 text-cyan-300" />
            </div>
            <div className="typo-body text-foreground max-w-[200px]">
              {t.plugins.drive.details_empty_hint}
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-primary/10">
          <div className="typo-label text-foreground">
            {t.plugins.drive.details_location}
          </div>
          <div className="mt-1 font-mono typo-body text-foreground break-all">
            {currentPath || "/"}
          </div>
        </div>
      </aside>
    );
  }

  const visual = visualForEntry(primary);
  const Icon = visual.Icon;

  return (
    <aside className="w-72 flex-shrink-0 border-l border-primary/10 bg-gradient-to-b from-background to-background/80 flex flex-col overflow-hidden">
      {/* Hero */}
      <div className="relative px-5 pt-5 pb-4 overflow-hidden">
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-br ${visual.gradient} opacity-80 pointer-events-none`}
        />
        <div className="relative flex flex-col items-center text-center">
          <div
            className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${visual.gradient} border border-primary/15 flex items-center justify-center shadow-inner`}
          >
            <Icon className={`w-10 h-10 ${visual.text}`} />
          </div>
          <div className="mt-3 typo-body typo-card-label break-all px-1 leading-tight">
            {multi
              ? tx(t.plugins.drive.items_selected_summary, { count: entries.length })
              : primary.name}
          </div>
          {!multi && (
            <div className="mt-1 typo-caption text-foreground uppercase tracking-wider">
              {primary.kind === "folder"
                ? t.plugins.drive.folder_kind
                : kindLabel(t, visual)}
            </div>
          )}
          {!multi &&
            primary.kind === "file" &&
            signedPaths?.has(primary.path) && (
              <div className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/25 typo-caption font-medium text-rose-100">
                <FileSignature className="w-3 h-3 flex-shrink-0" />
                <span>{t.plugins.drive.signed}</span>
              </div>
            )}
          {!multi && (
            <DetailsActionRow
              entry={primary}
              onOpen={onOpen}
              onReveal={onReveal}
              onSign={onSign}
              onVerify={onVerify}
              onExtractText={onExtractText}
              hasGemini={hasGemini}
            />
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-3 space-y-4">
        {!multi && (
          <DetailGrid>
            {primary.kind !== "folder" && (
              <DetailRow label={t.plugins.drive.details_size}>
                <span className="tabular-nums">
                  {driveFormatBytes(primary.size)}
                </span>
              </DetailRow>
            )}
            <DetailRow label={t.plugins.drive.details_modified}>
              {<AbsoluteTime timestamp={primary.modified} />}
            </DetailRow>
            <DetailRow label={t.plugins.drive.details_path}>
              <div className="flex items-start gap-1.5">
                <span className="font-mono typo-body break-all flex-1">
                  {primary.path || "/"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    copyText(primary.path || "/")
                      .catch(silentCatch("drive:copy-path"));
                  }}
                  className="p-1 rounded text-foreground hover:text-cyan-200 hover:bg-cyan-500/15 transition-colors flex-shrink-0 focus-ring"
                  aria-label={t.plugins.drive.copy_path_tooltip}
                  title={t.plugins.drive.copy_path_tooltip}
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </DetailRow>
          </DetailGrid>
        )}

        {multi && <MultiSelectSummary entries={entries} />}

        {!multi && primary.kind === "file" && (
          <div className="space-y-2">
            <div className="typo-label text-foreground">
              {t.plugins.drive.details_preview}
            </div>
            <FilePreview entry={primary} onPreviewClick={onPreviewClick} />
          </div>
        )}
      </div>
    </aside>
  );
}

/**
 * Per-file quick-action row in the details hero. Surfaces the same
 * single-entry actions the right-click context menu offers — open, reveal,
 * sign, verify, extract-text — so a user who already has a file selected
 * doesn't have to right-click to reach them. Icon-only to fit the 288px
 * pane; the labels ride as tooltips + aria-labels and reuse the context
 * menu's i18n keys + icon vocabulary so the two surfaces read identically.
 */
function DetailsActionRow({
  entry,
  onOpen,
  onReveal,
  onSign,
  onVerify,
  onExtractText,
  hasGemini = false,
}: {
  entry: DriveEntry;
  onOpen?: (entry: DriveEntry) => void;
  onReveal?: (entry: DriveEntry) => void;
  onSign?: (entry: DriveEntry) => void;
  onVerify?: (entry: DriveEntry) => void;
  onExtractText?: (entry: DriveEntry) => void;
  hasGemini?: boolean;
}) {
  const { t } = useTranslation();
  const isFile = entry.kind === "file";
  const ocrEligible = isFile && isOcrEligible(entry.mime, entry.extension);

  const actions: Array<{
    key: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }> = [];
  if (onOpen)
    actions.push({
      key: "open",
      icon: ExternalLink,
      label: t.plugins.drive.ctx_open,
      onClick: () => onOpen(entry),
    });
  if (onReveal)
    actions.push({
      key: "reveal",
      icon: FolderOpen,
      label: t.plugins.drive.ctx_reveal,
      onClick: () => onReveal(entry),
    });
  if (isFile && onSign)
    actions.push({
      key: "sign",
      icon: FileSignature,
      label: t.plugins.drive.ctx_sign_file,
      onClick: () => onSign(entry),
    });
  if (isFile && onVerify)
    actions.push({
      key: "verify",
      icon: ShieldCheck,
      label: t.plugins.drive.ctx_verify_file,
      onClick: () => onVerify(entry),
    });
  if (ocrEligible && onExtractText)
    actions.push({
      key: "ocr",
      icon: ScanLine,
      // Disabled-without-Gemini mirrors the context menu exactly: the OCR
      // backend can fall back to the Claude CLI, but the existing gate ties
      // the affordance to a connected Gemini credential — keep the two
      // surfaces consistent rather than diverging here.
      label: hasGemini
        ? t.plugins.drive.ctx_extract_text
        : t.plugins.drive.ctx_extract_text_no_gemini,
      onClick: () => onExtractText(entry),
      disabled: !hasGemini,
    });

  if (actions.length === 0) return null;

  return (
    <div className="mt-3 flex items-center justify-center gap-1 flex-wrap">
      {actions.map(({ key, icon: ActionIcon, label, onClick, disabled }) => (
        <button
          key={key}
          type="button"
          onClick={onClick}
          disabled={disabled}
          title={label}
          aria-label={label}
          className="p-2 rounded-input text-foreground bg-secondary/40 border border-primary/15 hover:text-cyan-100 hover:bg-cyan-500/15 hover:border-cyan-500/35 disabled:opacity-40 disabled:hover:bg-secondary/40 disabled:hover:text-foreground disabled:hover:border-primary/15 disabled:cursor-not-allowed transition-colors focus-ring"
        >
          <ActionIcon className="w-4 h-4" />
        </button>
      ))}
    </div>
  );
}

/**
 * Multi-selection summary card. Replaces a bare "5 items · 24 MB" with
 * a kind breakdown (3 Folders · 12 Images · 1 PDF) and a modified-range
 * line so the user can sanity-check what they've grabbed before any
 * bulk action. Mirrors the visual vocabulary of the delete-confirm
 * breakdown so the two surfaces speak the same language.
 */
function MultiSelectSummary({ entries }: { entries: DriveEntry[] }) {
  const { t, tx } = useTranslation();
  // Per-bucket count for the chip row.
  const buckets = (() => {
    const m = new Map<string, number>();
    for (const e of entries) {
      const k = visualForEntry(e).labelKey;
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return Array.from(m.entries()).sort(
      ([a], [b]) =>
        kindBucketWeight(a as Parameters<typeof kindBucketWeight>[0]) -
        kindBucketWeight(b as Parameters<typeof kindBucketWeight>[0]),
    );
  })();

  // Total bytes across files (folders excluded — they have no size).
  const totalBytes = entries.reduce(
    (sum, e) => sum + (e.kind === "file" ? e.size : 0),
    0,
  );

  // Modified range — only meaningful when there's at least one mtime.
  // ISO-8601 / RFC-3339 strings sort chronologically, so plain string
  // compare picks oldest/newest without a Date parse.
  const stamps = entries.map((e) => e.modified).filter((s): s is string => !!s);
  const first = stamps[0];
  let oldest: string | null = first ?? null;
  let newest: string | null = first ?? null;
  for (const s of stamps) {
    if (oldest === null || s < oldest) oldest = s;
    if (newest === null || s > newest) newest = s;
  }
  const sameMoment = oldest !== null && oldest === newest;

  return (
    <div className="rounded-card border border-primary/15 bg-secondary/30 p-3 space-y-2.5">
      {/* Top row — total count + total size. */}
      <div>
        <div className="typo-label text-foreground">
          {t.plugins.drive.details_items}
        </div>
        <div className="mt-1 typo-body text-foreground font-semibold tabular-nums">
          {entries.length}
          {totalBytes > 0 && (
            <span className="ml-1.5 font-normal text-foreground">
              • {driveFormatBytes(totalBytes)}
            </span>
          )}
        </div>
      </div>

      {/* Kind breakdown chips. */}
      {buckets.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {buckets.map(([key, count]) => (
            <span
              key={key}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/15 typo-caption text-foreground"
            >
              <span className="font-semibold tabular-nums">{count}</span>
              <span className="text-foreground">
                {kindGroupLabel(
                  t,
                  key as Parameters<typeof kindGroupLabel>[1],
                )}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Modified range. */}
      {newest && oldest && (
        <div className="pt-1.5 border-t border-primary/10 typo-caption text-foreground">
          {sameMoment
            ? formatRelativeTime(newest, t, tx)
            : tx(t.plugins.drive.details_modified_range, {
                newest: formatRelativeTime(newest, t, tx),
                oldest: formatRelativeTime(oldest, t, tx),
              })}
        </div>
      )}
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-primary/15 bg-secondary/30 divide-y divide-primary/10 overflow-hidden">
      {children}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="px-3 py-2.5">
      <div className="typo-label text-foreground mb-1.5">
        {label}
      </div>
      <div className="typo-body text-foreground break-words">{children}</div>
    </div>
  );
}

function FilePreview({
  entry,
  onPreviewClick,
}: {
  entry: DriveEntry;
  onPreviewClick?: (entry: DriveEntry) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "unsupported" | "too_large" | "video" | "pdf"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setText(null);

    const mime = entry.mime ?? "";
    if (mime.startsWith(IMAGE_MIME_PREFIX)) {
      setState("ready");
      return;
    }
    // Video + PDF render an "Open in viewer" CTA; the lightbox handles
    // the full playback / iframe rendering. We don't preload the bytes
    // here — the lightbox fetches them on open so the Details pane stays
    // light for files the user never expands.
    if (mime.startsWith(VIDEO_MIME_PREFIX)) {
      setState("video");
      return;
    }
    if (mime === PDF_MIME) {
      setState("pdf");
      return;
    }

    if (entry.size > TEXT_PREVIEW_MAX_BYTES) {
      setState("too_large");
      return;
    }

    const isText =
      mime.startsWith("text/") ||
      mime.includes("json") ||
      mime.includes("yaml") ||
      mime.includes("toml") ||
      mime.includes("javascript") ||
      mime.includes("typescript") ||
      mime.includes("csv");

    if (!isText) {
      setState("unsupported");
      return;
    }

    driveReadText(entry.path)
      .then((content) => {
        if (!cancelled) {
          setText(content);
          setState("ready");
        }
      })
      .catch(silentCatch("drive:preview"));

    return () => {
      cancelled = true;
    };
  }, [entry.path, entry.mime, entry.size]);

  if (state === "loading") {
    return (
      <div className="rounded-card border border-primary/10 bg-secondary/25 px-3 py-4 text-center typo-body text-foreground">
        {t.plugins.drive.loading}
      </div>
    );
  }
  if (state === "too_large") {
    return (
      <div className="rounded-card border border-amber-500/35 bg-amber-500/10 px-3 py-3 typo-body text-amber-100">
        {t.plugins.drive.preview_too_large}
      </div>
    );
  }
  if (state === "unsupported") {
    return (
      <div className="rounded-card border border-primary/10 bg-secondary/25 px-3 py-3 typo-body text-foreground">
        {t.plugins.drive.preview_binary}
      </div>
    );
  }
  if (state === "video") {
    return (
      <OpenInLightboxCTA
        entry={entry}
        icon={Play}
        label={t.plugins.drive.preview_open_video}
        accent="rose"
        onPreviewClick={onPreviewClick}
      />
    );
  }
  if (state === "pdf") {
    return (
      <OpenInLightboxCTA
        entry={entry}
        icon={FileText}
        label={t.plugins.drive.preview_open_pdf}
        accent="red"
        onPreviewClick={onPreviewClick}
      />
    );
  }
  if (entry.mime?.startsWith(IMAGE_MIME_PREFIX)) {
    return <ImagePreviewBlob entry={entry} onPreviewClick={onPreviewClick} />;
  }
  if (text !== null) {
    return (
      <pre className="max-h-72 overflow-auto rounded-card border border-primary/15 bg-background/70 p-3 typo-body font-mono text-foreground whitespace-pre-wrap break-words leading-relaxed">
        {text.slice(0, 4000)}
      </pre>
    );
  }
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/25 px-3 py-3 typo-body text-foreground">
      {t.plugins.drive.preview_unavailable}
    </div>
  );
}

/**
 * "Open in viewer" call-to-action — used by the video and PDF preview
 * branches. Mirrors the visual of the image-preview thumbnail so the
 * "click to expand" affordance is consistent across kinds.
 */
function OpenInLightboxCTA({
  entry,
  icon: Icon,
  label,
  accent,
  onPreviewClick,
}: {
  entry: DriveEntry;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent: "rose" | "red";
  onPreviewClick?: (entry: DriveEntry) => void;
}) {
  const styles =
    accent === "rose"
      ? "border-rose-500/35 bg-gradient-to-br from-rose-500/15 via-rose-500/5 to-transparent text-rose-100 hover:border-rose-500/55 hover:from-rose-500/25"
      : "border-red-500/35 bg-gradient-to-br from-red-500/15 via-red-500/5 to-transparent text-red-100 hover:border-red-500/55 hover:from-red-500/25";
  if (!onPreviewClick) {
    return (
      <div
        className={`flex items-center justify-center gap-2 px-3 py-6 rounded-card border ${styles}`}
      >
        <Icon className="w-4 h-4" />
        <span className="typo-body font-medium">{label}</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPreviewClick(entry)}
      className={`group w-full flex items-center justify-center gap-2 px-3 py-6 rounded-card border transition-all cursor-zoom-in focus-ring ${styles}`}
    >
      <Icon className="w-4 h-4 group-hover:scale-110 transition-transform" />
      <span className="typo-body font-semibold">{label}</span>
    </button>
  );
}

function ImagePreviewBlob({
  entry,
  onPreviewClick,
}: {
  entry: DriveEntry;
  onPreviewClick?: (entry: DriveEntry) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let current: string | null = null;
    import("@/api/drive").then(async ({ driveRead }) => {
      try {
        const bytes = await driveRead(entry.path);
        const blob = new Blob([new Uint8Array(bytes)], {
          type: entry.mime ?? "application/octet-stream",
        });
        current = URL.createObjectURL(blob);
        setUrl(current);
      } catch (err) {
        silentCatch("drive:image-preview")(err);
      }
    });
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [entry.path, entry.mime]);

  if (!url) return null;
  // No click target if the parent didn't wire a lightbox; the preview is
  // still rendered as a plain image.
  if (!onPreviewClick) {
    return (
      <div className="rounded-card border border-primary/10 bg-background/60 p-1 overflow-hidden">
        <img
          src={url}
          alt={entry.name}
          className="rounded-input max-w-full max-h-56 object-contain mx-auto"
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onPreviewClick(entry)}
      className="group block w-full rounded-card border border-primary/10 bg-background/60 p-1 overflow-hidden hover:border-cyan-500/40 hover:shadow-[0_0_20px_-6px_rgba(34,211,238,0.5)] transition-all cursor-zoom-in focus-ring"
    >
      <img
        src={url}
        alt={entry.name}
        className="rounded-input max-w-full max-h-56 object-contain mx-auto group-hover:scale-[1.02] transition-transform"
      />
    </button>
  );
}
