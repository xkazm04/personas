import { useEffect, useState } from "react";
import { File, Folder, HardDrive } from "lucide-react";

import { driveFormatBytes, driveReadText, type DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";

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
      <aside className="w-64 flex-shrink-0 border-l border-primary/10 bg-background/30 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <HardDrive className="w-4 h-4 text-sky-400" />
          <span className="typo-caption font-semibold text-foreground/80">
            {t.plugins.drive.details_title}
          </span>
        </div>
        <div className="typo-caption-sm text-foreground/50">
          {currentPath || t.plugins.drive.sidebar_root}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 flex-shrink-0 border-l border-primary/10 bg-background/30 px-4 py-3 overflow-y-auto">
      <div className="flex items-center gap-2 mb-3">
        {primary.kind === "folder" ? (
          <Folder className="w-4 h-4 text-sky-400" />
        ) : (
          <File className="w-4 h-4 text-foreground/60" />
        )}
        <span className="typo-caption font-semibold text-foreground/80 truncate">
          {multi ? `${entries.length} selected` : primary.name}
        </span>
      </div>

      {!multi && (
        <DetailGrid>
          <DetailRow label={t.plugins.drive.details_kind}>
            {primary.kind === "folder"
              ? t.plugins.drive.folder_kind
              : (primary.extension?.toUpperCase() ?? "File")}
          </DetailRow>
          {primary.kind !== "folder" && (
            <DetailRow label={t.plugins.drive.details_size}>
              {driveFormatBytes(primary.size)}
            </DetailRow>
          )}
          <DetailRow label={t.plugins.drive.details_modified}>
            {new Date(primary.modified).toLocaleString()}
          </DetailRow>
          <DetailRow label={t.plugins.drive.details_path}>
            <span className="font-mono text-[10px] break-all">
              {primary.path || "/"}
            </span>
          </DetailRow>
        </DetailGrid>
      )}

      {multi && (
        <div className="typo-caption text-foreground/60">
          {t.plugins.drive.details_items}: {entries.length} \u2022{" "}
          {driveFormatBytes(
            entries.reduce((sum, e) => sum + (e.kind === "file" ? e.size : 0), 0),
          )}
        </div>
      )}

      {!multi && primary.kind === "file" && (
        <div className="mt-4">
          <div className="typo-caption font-semibold text-foreground/70 mb-2">
            {t.plugins.drive.details_preview}
          </div>
          <FilePreview entry={primary} />
        </div>
      )}
    </aside>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="typo-caption-sm text-foreground/40 uppercase tracking-wide">
        {label}
      </div>
      <div className="typo-caption text-foreground/80 break-words">
        {children}
      </div>
    </div>
  );
}

function FilePreview({ entry }: { entry: DriveEntry }) {
  const { t } = useTranslation();
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "unsupported" | "too_large">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setText(null);

    const mime = entry.mime ?? "";
    if (mime.startsWith(IMAGE_MIME_PREFIX)) {
      // Images are rendered below via a data URL.
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
      <div className="typo-caption-sm text-foreground/40">
        {t.plugins.drive.loading}
      </div>
    );
  }
  if (state === "too_large") {
    return (
      <div className="typo-caption-sm text-foreground/40">
        {t.plugins.drive.preview_too_large}
      </div>
    );
  }
  if (state === "unsupported") {
    return (
      <div className="typo-caption-sm text-foreground/40">
        {t.plugins.drive.preview_binary}
      </div>
    );
  }
  if (entry.mime?.startsWith(IMAGE_MIME_PREFIX)) {
    // Use convertFileSrc-style path; Tauri asset protocol isn't available for
    // arbitrary files on disk, so we fall back to drive_read + blob URL.
    return <ImagePreviewBlob entry={entry} />;
  }
  if (text !== null) {
    return (
      <pre className="max-h-64 overflow-auto rounded border border-primary/10 bg-secondary/20 p-2 typo-caption-sm font-mono text-foreground/80 whitespace-pre-wrap break-words">
        {text.slice(0, 4000)}
      </pre>
    );
  }
  return (
    <div className="typo-caption-sm text-foreground/40">
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
    <img
      src={url}
      alt={entry.name}
      className="rounded border border-primary/15 max-w-full max-h-48 object-contain"
    />
  );
}
