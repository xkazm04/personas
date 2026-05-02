/**
 * Visual design tokens for the Drive plugin. Centralises the colour,
 * gradient, and icon mapping for file types so every view (list, icons,
 * columns, details pane) renders them consistently.
 */
import {
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  Image as ImageIcon,
  Music,
  Video,
  Archive,
  Braces,
  Table,
  FileType,
  FileSignature,
  type LucideIcon,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { Translations } from "@/i18n/en";

/** Translatable kind labels surfaced in the Details pane and List view. */
type DriveKindLabelKey =
  | "kind_folder"
  | "kind_image"
  | "kind_audio"
  | "kind_video"
  | "kind_pdf"
  | "kind_code"
  | "kind_data"
  | "kind_sheet"
  | "kind_archive"
  | "kind_text"
  | "kind_signature"
  | "kind_generic";

export interface DriveFileVisual {
  Icon: LucideIcon;
  /** Full Tailwind class for the file-type chip background gradient. */
  gradient: string;
  /** Solid text colour for the icon stroke. */
  text: string;
  /** Glow colour used for selection / hover rings. */
  ring: string;
  /** i18n key under `t.plugins.drive` for the human-readable category. */
  labelKey: DriveKindLabelKey;
}

const PRESETS = {
  folder: {
    Icon: Folder,
    gradient: "from-sky-500/25 via-sky-500/10 to-sky-500/5",
    text: "text-sky-300",
    ring: "ring-sky-500/40",
    labelKey: "kind_folder",
  },
  folderOpen: {
    Icon: FolderOpen,
    gradient: "from-sky-500/30 via-sky-500/15 to-sky-500/5",
    text: "text-sky-200",
    ring: "ring-sky-500/50",
    labelKey: "kind_folder",
  },
  image: {
    Icon: ImageIcon,
    gradient: "from-emerald-500/25 via-teal-500/10 to-emerald-500/5",
    text: "text-emerald-300",
    ring: "ring-emerald-500/40",
    labelKey: "kind_image",
  },
  audio: {
    Icon: Music,
    gradient: "from-pink-500/25 via-fuchsia-500/10 to-pink-500/5",
    text: "text-pink-300",
    ring: "ring-pink-500/40",
    labelKey: "kind_audio",
  },
  video: {
    Icon: Video,
    gradient: "from-rose-500/25 via-red-500/10 to-rose-500/5",
    text: "text-rose-300",
    ring: "ring-rose-500/40",
    labelKey: "kind_video",
  },
  pdf: {
    Icon: FileType,
    gradient: "from-red-500/25 via-red-500/10 to-red-500/5",
    text: "text-red-300",
    ring: "ring-red-500/40",
    labelKey: "kind_pdf",
  },
  code: {
    Icon: FileCode,
    gradient: "from-violet-500/25 via-purple-500/10 to-violet-500/5",
    text: "text-violet-300",
    ring: "ring-violet-500/40",
    labelKey: "kind_code",
  },
  data: {
    Icon: Braces,
    gradient: "from-amber-500/25 via-yellow-500/10 to-amber-500/5",
    text: "text-amber-300",
    ring: "ring-amber-500/40",
    labelKey: "kind_data",
  },
  sheet: {
    Icon: Table,
    gradient: "from-teal-500/25 via-cyan-500/10 to-teal-500/5",
    text: "text-teal-300",
    ring: "ring-teal-500/40",
    labelKey: "kind_sheet",
  },
  archive: {
    Icon: Archive,
    gradient: "from-orange-500/25 via-amber-500/10 to-orange-500/5",
    text: "text-orange-300",
    ring: "ring-orange-500/40",
    labelKey: "kind_archive",
  },
  text: {
    Icon: FileText,
    gradient: "from-slate-400/25 via-slate-400/10 to-slate-400/5",
    text: "text-foreground",
    ring: "ring-slate-400/40",
    labelKey: "kind_text",
  },
  signature: {
    Icon: FileSignature,
    gradient: "from-fuchsia-500/25 via-pink-500/10 to-fuchsia-500/5",
    text: "text-fuchsia-300",
    ring: "ring-fuchsia-500/40",
    labelKey: "kind_signature",
  },
  generic: {
    Icon: File,
    gradient: "from-slate-500/20 via-slate-500/10 to-slate-500/5",
    text: "text-foreground",
    ring: "ring-foreground/30",
    labelKey: "kind_generic",
  },
} as const satisfies Record<string, DriveFileVisual>;

/**
 * Resolve a visual's label key against the translations object. Folders use
 * the existing `folder_kind` token (for parity with the Kind column).
 */
export function kindLabel(t: Translations, visual: DriveFileVisual): string {
  return t.plugins.drive[visual.labelKey];
}

/**
 * Pick a visual preset for a drive entry, using its mime + extension.
 */
export function visualForEntry(entry: DriveEntry, opened = false): DriveFileVisual {
  if (entry.kind === "folder") {
    return opened ? PRESETS.folderOpen : PRESETS.folder;
  }
  const ext = entry.extension ?? "";
  if (ext === "sig" || entry.name.endsWith(".sig.json")) return PRESETS.signature;
  const mime = entry.mime ?? "";
  if (mime.startsWith("image/")) return PRESETS.image;
  if (mime.startsWith("audio/")) return PRESETS.audio;
  if (mime.startsWith("video/")) return PRESETS.video;
  if (mime.includes("pdf")) return PRESETS.pdf;
  if (mime.includes("json") || mime.includes("yaml") || mime.includes("toml"))
    return PRESETS.data;
  if (mime.includes("csv") || mime.includes("tab-separated")) return PRESETS.sheet;
  if (mime.includes("typescript") || mime.includes("javascript")) return PRESETS.code;
  if (mime.startsWith("text/") || ext === "md" || ext === "markdown")
    return PRESETS.text;
  if (
    mime.includes("zip") ||
    mime.includes("tar") ||
    mime.includes("gzip") ||
    ext === "7z" ||
    ext === "rar"
  )
    return PRESETS.archive;
  return PRESETS.generic;
}

type Tx = (template: string, params: Record<string, string | number>) => string;

/**
 * Format a duration ("2m ago", "yesterday", "Apr 13") for the modified column.
 *
 * Threads `t` + `tx` from useTranslation so the relative-time tokens land in
 * the user's language with locale-correct plural forms (e.g. Russian/Czech
 * pick `_other` for n=2..4, `_other` for >4 etc.). The absolute-date fallback
 * uses `Date.toLocaleDateString` with `undefined` locale, which honors the
 * browser/system language.
 */
export function formatRelativeTime(
  iso: string,
  t: Translations,
  tx: Tx,
): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const delta = (now - then) / 1000;
  if (delta < 60) return t.plugins.drive.time_just_now;
  if (delta < 3600) {
    const count = Math.floor(delta / 60);
    return tx(
      count === 1
        ? t.plugins.drive.time_minutes_ago_one
        : t.plugins.drive.time_minutes_ago_other,
      { count },
    );
  }
  if (delta < 86_400) {
    const count = Math.floor(delta / 3600);
    return tx(
      count === 1
        ? t.plugins.drive.time_hours_ago_one
        : t.plugins.drive.time_hours_ago_other,
      { count },
    );
  }
  if (delta < 86_400 * 2) return t.plugins.drive.time_yesterday;
  if (delta < 86_400 * 7) {
    const count = Math.floor(delta / 86_400);
    return tx(
      count === 1
        ? t.plugins.drive.time_days_ago_one
        : t.plugins.drive.time_days_ago_other,
      { count },
    );
  }
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
