import { useEffect, useRef } from "react";
import {
  ExternalLink,
  FolderOpen,
  Pencil,
  Copy,
  Scissors,
  ClipboardPaste,
  Trash2,
  FolderPlus,
  FilePlus,
  Link as LinkIcon,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";

export interface ContextMenuState {
  x: number;
  y: number;
  entry: DriveEntry | null;
}

interface Props {
  state: ContextMenuState;
  drive: UseDriveResult;
  onClose: () => void;
  onOpen: (entry: DriveEntry) => void;
  onNewFolder: () => void;
  onNewFile: () => void;
  onRename: (entry: DriveEntry) => void;
  onRequestDelete: (paths: string[]) => void;
  onReveal: (entry: DriveEntry) => void;
  onCopyPath: (entry: DriveEntry) => void;
}

export function DriveContextMenu({
  state,
  drive,
  onClose,
  onOpen,
  onNewFolder,
  onNewFile,
  onRename,
  onRequestDelete,
  onReveal,
  onCopyPath,
}: Props) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    setTimeout(() => document.addEventListener("mousedown", handler), 0);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", esc);
    };
  }, [onClose]);

  const { entry } = state;
  const hasSelection = drive.selection.size > 0;
  const paths = hasSelection
    ? Array.from(drive.selection)
    : entry
    ? [entry.path]
    : [];

  // Constrain within viewport
  const maxX =
    typeof window !== "undefined" ? window.innerWidth - 220 : state.x;
  const maxY =
    typeof window !== "undefined" ? window.innerHeight - 380 : state.y;
  const x = Math.min(state.x, maxX);
  const y = Math.min(state.y, maxY);

  const item = (
    icon: React.ReactNode,
    label: string,
    onClick: () => void,
    opts: { danger?: boolean; disabled?: boolean; shortcut?: string } = {},
  ) => (
    <button
      type="button"
      disabled={opts.disabled}
      onClick={() => {
        if (!opts.disabled) {
          onClick();
          onClose();
        }
      }}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 typo-caption text-left transition-colors ${
        opts.disabled
          ? "text-foreground/30 cursor-not-allowed"
          : opts.danger
          ? "text-rose-400 hover:bg-rose-500/15"
          : "text-foreground/80 hover:bg-sky-500/15 hover:text-sky-100"
      }`}
    >
      <span className="w-3.5 h-3.5 flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {opts.shortcut && (
        <kbd className="ml-auto typo-caption-sm text-foreground/40 font-mono">
          {opts.shortcut}
        </kbd>
      )}
    </button>
  );

  const divider = (
    <div className="my-1 border-t border-primary/15" aria-hidden />
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] w-52 rounded-lg border border-primary/15 bg-background/95 backdrop-blur shadow-xl py-1"
      style={{ left: x, top: y }}
    >
      {entry ? (
        <>
          {item(
            <ExternalLink className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_open,
            () => onOpen(entry),
          )}
          {item(
            <FolderOpen className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_reveal,
            () => onReveal(entry),
          )}
          {divider}
          {item(
            <Pencil className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_rename,
            () => onRename(entry),
            { shortcut: "F2", disabled: drive.selection.size > 1 },
          )}
          {item(
            <Copy className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_copy,
            () => drive.copySelection(),
            { shortcut: "Ctrl+C" },
          )}
          {item(
            <Scissors className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_cut,
            () => drive.cutSelection(),
            { shortcut: "Ctrl+X" },
          )}
          {item(
            <LinkIcon className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_copy_path,
            () => onCopyPath(entry),
          )}
          {divider}
          {item(
            <Trash2 className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_delete,
            () => onRequestDelete(paths),
            { danger: true, shortcut: "Del" },
          )}
        </>
      ) : (
        <>
          {item(
            <FolderPlus className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_new_folder,
            onNewFolder,
          )}
          {item(
            <FilePlus className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_new_file,
            onNewFile,
          )}
          {divider}
          {item(
            <ClipboardPaste className="w-3.5 h-3.5" />,
            t.plugins.drive.ctx_paste,
            () => drive.pasteHere(),
            { shortcut: "Ctrl+V", disabled: !drive.clipboard },
          )}
        </>
      )}
    </div>
  );
}
