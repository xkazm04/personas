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

export interface DriveFileVisual {
  Icon: LucideIcon;
  /** Full Tailwind class for the file-type chip background gradient. */
  gradient: string;
  /** Solid text colour for the icon stroke. */
  text: string;
  /** Glow colour used for selection / hover rings. */
  ring: string;
  /** Human-readable category (used in Details pane). */
  label: string;
}

const PRESETS = {
  folder: {
    Icon: Folder,
    gradient: "from-sky-500/25 via-sky-500/10 to-sky-500/5",
    text: "text-sky-300",
    ring: "ring-sky-500/40",
    label: "Folder",
  },
  folderOpen: {
    Icon: FolderOpen,
    gradient: "from-sky-500/30 via-sky-500/15 to-sky-500/5",
    text: "text-sky-200",
    ring: "ring-sky-500/50",
    label: "Folder",
  },
  image: {
    Icon: ImageIcon,
    gradient: "from-emerald-500/25 via-teal-500/10 to-emerald-500/5",
    text: "text-emerald-300",
    ring: "ring-emerald-500/40",
    label: "Image",
  },
  audio: {
    Icon: Music,
    gradient: "from-pink-500/25 via-fuchsia-500/10 to-pink-500/5",
    text: "text-pink-300",
    ring: "ring-pink-500/40",
    label: "Audio",
  },
  video: {
    Icon: Video,
    gradient: "from-rose-500/25 via-red-500/10 to-rose-500/5",
    text: "text-rose-300",
    ring: "ring-rose-500/40",
    label: "Video",
  },
  pdf: {
    Icon: FileType,
    gradient: "from-red-500/25 via-red-500/10 to-red-500/5",
    text: "text-red-300",
    ring: "ring-red-500/40",
    label: "PDF",
  },
  code: {
    Icon: FileCode,
    gradient: "from-violet-500/25 via-purple-500/10 to-violet-500/5",
    text: "text-violet-300",
    ring: "ring-violet-500/40",
    label: "Code",
  },
  data: {
    Icon: Braces,
    gradient: "from-amber-500/25 via-yellow-500/10 to-amber-500/5",
    text: "text-amber-300",
    ring: "ring-amber-500/40",
    label: "Data",
  },
  sheet: {
    Icon: Table,
    gradient: "from-teal-500/25 via-cyan-500/10 to-teal-500/5",
    text: "text-teal-300",
    ring: "ring-teal-500/40",
    label: "Sheet",
  },
  archive: {
    Icon: Archive,
    gradient: "from-orange-500/25 via-amber-500/10 to-orange-500/5",
    text: "text-orange-300",
    ring: "ring-orange-500/40",
    label: "Archive",
  },
  text: {
    Icon: FileText,
    gradient: "from-slate-400/25 via-slate-400/10 to-slate-400/5",
    text: "text-foreground",
    ring: "ring-slate-400/40",
    label: "Document",
  },
  signature: {
    Icon: FileSignature,
    gradient: "from-fuchsia-500/25 via-pink-500/10 to-fuchsia-500/5",
    text: "text-fuchsia-300",
    ring: "ring-fuchsia-500/40",
    label: "Signature",
  },
  generic: {
    Icon: File,
    gradient: "from-slate-500/20 via-slate-500/10 to-slate-500/5",
    text: "text-foreground",
    ring: "ring-foreground/30",
    label: "File",
  },
} as const satisfies Record<string, DriveFileVisual>;

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

/**
 * Format a duration ("2m ago", "yesterday", "Apr 13") for the modified column.
 */
export function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return iso;
  const delta = (now - then) / 1000;
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86_400) return `${Math.floor(delta / 3600)}h ago`;
  if (delta < 86_400 * 2) return "yesterday";
  if (delta < 86_400 * 7) return `${Math.floor(delta / 86_400)}d ago`;
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
