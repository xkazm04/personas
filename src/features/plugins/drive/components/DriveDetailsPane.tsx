import { useEffect, useState } from "react";
import { Copy, Info } from "lucide-react";

import { driveFormatBytes, driveReadText, type DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import { visualForEntry } from "../designTokens";

interface Props {
  entries: DriveEntry[];
  currentPath: string;
}

const TEXT_PREVIEW_MAX_BYTES = 256 * 1024; // 256 KB
const IMAGE_MIME_PREFIX = "image/";

export function DriveDetailsPane({ entries, currentPath }: Props) {
  const { t } = useTranslation();
  const primary = entries[0] ?? null;
  const multi = entries.length > 1;

  if (!primary) {
    return (
      <aside className="w-72 flex-shrink-0 border-l border-primary/10 bg-gradient-to-b from-background to-background/60 px-5 py-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-cyan-300" />
          <span className="typo-caption font-semibold text-foreground uppercase tracking-wider">
            {t.plugins.drive.details_title}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center px-4">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-cyan-500/15 to-sky-500/5 border border-cyan-500/20 flex items-center justify-center mb-3">
              <Info className="w-7 h-7 text-cyan-300/70" />
            </div>
            <div className="typo-caption text-foreground/65 max-w-[200px]">
              Select a file or folder to see its details and inline preview.
            </div>
          </div>
        </div>
        <div className="pt-3 border-t border-primary/10">
          <div className="typo-caption-sm text-foreground/45 uppercase tracking-wider">
            Location
          </div>
          <div className="mt-1 font-mono text-[10px] text-foreground/65 break-all">
            {currentPath || "/"}
          </div>
        </div>
      </aside>
    );
  }

  const visual = visualForEntry(primary);
  const Icon = visual.Icon;

  return (
    <aside className="w-72 flex-shrink-0 border-l border-primary/10 bg-gradient-to-b from-background to-background/60 flex flex-col overflow-hidden">
      {/* Hero */}
      <div className="relative px-5 pt-5 pb-4 overflow-hidden">
        <div
          aria-hidden
          className={`absolute inset-0 bg-gradient-to-br ${visual.gradient} opacity-80 pointer-events-none`}
        />
        <div className="relative flex flex-col items-center text-center">
          <div
            className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${visual.gradient} border border-primary/10 flex items-center justify-center shadow-inner`}
          >
            <Icon className={`w-10 h-10 ${visual.text}`} />
          </div>
          <div className="mt-3 typo-body font-semibold text-foreground break-all px-1 leading-tight">
            {multi ? `${entries.length} items selected` : primary.name}
          </div>
          {!multi && (
            <div className="mt-1 typo-caption-sm text-foreground/65">
              {primary.kind === "folder"
                ? t.plugins.drive.folder_kind
                : visual.label}
            </div>
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
              {new Date(primary.modified).toLocaleString()}
            </DetailRow>
            <DetailRow label={t.plugins.drive.details_path}>
              <div className="flex items-start gap-1.5">
                <span className="font-mono text-[10px] break-all flex-1">
                  {primary.path || "/"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(primary.path || "/")
                      .catch(() => {
                        /* ignore */
                      });
                  }}
                  className="p-1 rounded text-foreground/55 hover:text-cyan-300 hover:bg-cyan-500/10 transition-colors flex-shrink-0"
                  aria-label="Copy path"
                  title="Copy path"
                >
                  <Copy className="w-3 h-3" />
                </button>
              </div>
            </DetailRow>
          </DetailGrid>
        )}

        {multi && (
          <div className="rounded-lg border border-primary/10 bg-secondary/30 p-3">
            <div className="typo-caption-sm text-foreground/55 uppercase tracking-wider">
              {t.plugins.drive.details_items}
            </div>
            <div className="mt-1 typo-body text-foreground">
              {entries.length}
              <span className="ml-1.5 typo-caption text-foreground/65">
                • {driveFormatBytes(
                  entries.reduce(
                    (sum, e) => sum + (e.kind === "file" ? e.size : 0),
                    0,
                  ),
                )}
              </span>
            </div>
          </div>
        )}

        {!multi && primary.kind === "file" && (
          <div className="space-y-2">
            <div className="typo-caption-sm font-semibold text-foreground/55 uppercase tracking-wider">
              {t.plugins.drive.details_preview}
            </div>
            <FilePreview entry={primary} />
          </div>
        )}
      </div>
    </aside>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/25 divide-y divide-primary/10 overflow-hidden">
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
    <div className="px-3 py-2">
      <div className="typo-caption-sm text-foreground/55 uppercase tracking-wider mb-1">
        {label}
      </div>
      <div className="typo-caption text-foreground break-words">{children}</div>
    </div>
  );
}

function FilePreview({ entry }: { entry: DriveEntry }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<
    "loading" | "ready" | "unsupported" | "too_large"
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
      <div className="rounded-lg border border-primary/10 bg-secondary/20 px-3 py-4 text-center typo-caption-sm text-foreground/55">
        {t.plugins.drive.loading}
      </div>
    );
  }
  if (state === "too_large") {
    return (
      <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-3 typo-caption-sm text-amber-200">
        {t.plugins.drive.preview_too_large}
      </div>
    );
  }
  if (state === "unsupported") {
    return (
      <div className="rounded-lg border border-primary/10 bg-secondary/20 px-3 py-3 typo-caption-sm text-foreground/60">
        {t.plugins.drive.preview_binary}
      </div>
    );
  }
  if (entry.mime?.startsWith(IMAGE_MIME_PREFIX)) {
    return <ImagePreviewBlob entry={entry} />;
  }
  if (text !== null) {
    return (
      <pre className="max-h-72 overflow-auto rounded-lg border border-primary/10 bg-background/60 p-3 typo-caption-sm font-mono text-foreground/85 whitespace-pre-wrap break-words leading-relaxed">
        {text.slice(0, 4000)}
      </pre>
    );
  }
  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/20 px-3 py-3 typo-caption-sm text-foreground/55">
      {t.plugins.drive.preview_unavailable}
    </div>
  );
}

function ImagePreviewBlob({ entry }: { entry: DriveEntry }) {
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
      } catch {
        /* ignore */
      }
    });
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [entry.path, entry.mime]);

  if (!url) return null;
  return (
    <div className="rounded-lg border border-primary/10 bg-background/60 p-1 overflow-hidden">
      <img
        src={url}
        alt={entry.name}
        className="rounded-md max-w-full max-h-56 object-contain mx-auto"
      />
    </div>
  );
}
