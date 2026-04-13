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
  FileSignature,
  ShieldCheck,
  ScanLine,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";
import { isOcrEligible } from "../ocr/useOcr";

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
  onSignFile: (entry: DriveEntry) => void;
  onVerifyFile: (entry: DriveEntry) => void;
  onExtractText: (entry: DriveEntry) => void;
  hasGemini: boolean;
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
  onSignFile,
  onVerifyFile,
  onExtractText,
  hasGemini,
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
      className={`w-full flex items-center gap-2.5 px-3 py-2 typo-caption text-left transition-all rounded-md mx-1 ${
        opts.disabled
          ? "text-foreground/30 cursor-not-allowed"
          : opts.danger
          ? "text-rose-300 hover:bg-gradient-to-r hover:from-rose-500/25 hover:to-rose-500/5 hover:text-rose-100"
          : "text-foreground/85 hover:bg-gradient-to-r hover:from-cyan-500/25 hover:to-cyan-500/5 hover:text-cyan-50"
      }`}
    >
      <span className="w-3.5 h-3.5 flex-shrink-0">{icon}</span>
      <span className="flex-1">{label}</span>
      {opts.shortcut && (
        <kbd className="ml-auto typo-caption-sm text-foreground/45 font-mono tracking-tight">
          {opts.shortcut}
        </kbd>
      )}
    </button>
  );

  const divider = (
    <div className="my-1 mx-2 border-t border-primary/10" aria-hidden />
  );

  return (
    <div
      ref={ref}
      className="fixed z-[9999] w-56 rounded-xl border border-primary/20 bg-background/95 backdrop-blur-md shadow-[0_20px_60px_-20px_rgba(0,0,0,0.6),0_0_30px_-8px_rgba(34,211,238,0.25)] py-1.5"
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
          {entry.kind === "file" && (
            <>
              {divider}
              {item(
                <FileSignature className="w-3.5 h-3.5" />,
                t.plugins.drive.ctx_sign_file,
                () => onSignFile(entry),
                { disabled: drive.selection.size > 1 },
              )}
              {item(
                <ShieldCheck className="w-3.5 h-3.5" />,
                t.plugins.drive.ctx_verify_file,
                () => onVerifyFile(entry),
                { disabled: drive.selection.size > 1 },
              )}
              {isOcrEligible(entry.mime, entry.extension) &&
                item(
                  <ScanLine className="w-3.5 h-3.5" />,
                  hasGemini
                    ? t.plugins.drive.ctx_extract_text
                    : t.plugins.drive.ctx_extract_text_no_gemini,
                  () => onExtractText(entry),
                  { disabled: !hasGemini || drive.selection.size > 1 },
                )}
            </>
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
