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
  Brain,
  Sparkles,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { UseDriveResult } from "../hooks/useDrive";
import { useTranslation } from "@/i18n/useTranslation";
import { isOcrEligible } from "../ocr/useOcr";
import {
  ContextMenu,
  type ContextMenuItem,
} from "@/features/shared/components/overlays/ContextMenu";

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
  /** Send an entry (or, with no entry, the open folder) to a knowledge base. */
  onAddToKnowledge: (entry: DriveEntry | null) => void;
  /** Open the ask/extract surface without ingesting anything first. */
  onOpenKnowledge: () => void;
  /** False on builds without the ML/KB lane — both items stay hidden. */
  knowledgeAvailable: boolean;
}

/**
 * Drive's file/folder right-click menu.
 *
 * The item SET is the interesting part and stays here; positioning, dismissal,
 * dividers and keyboard navigation come from the shared `ContextMenu`. The
 * rose divider above Delete survives as `separatorBefore` on a `danger` item —
 * it fences off the destructive zone before the cursor lands on it.
 */
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
  onAddToKnowledge,
  onOpenKnowledge,
  knowledgeAvailable,
}: Props) {
  const { t } = useTranslation();
  const { entry } = state;
  const hasSelection = drive.selection.size > 0;
  const paths = hasSelection ? Array.from(drive.selection) : entry ? [entry.path] : [];
  const multi = drive.selection.size > 1;

  const items: ContextMenuItem[] = entry
    ? [
        {
          id: "open",
          label: t.plugins.drive.ctx_open,
          icon: <ExternalLink className="w-3.5 h-3.5" />,
          onSelect: () => onOpen(entry),
        },
        {
          id: "reveal",
          label: t.plugins.drive.ctx_reveal,
          icon: <FolderOpen className="w-3.5 h-3.5" />,
          onSelect: () => onReveal(entry),
        },
        {
          id: "rename",
          label: t.plugins.drive.ctx_rename,
          icon: <Pencil className="w-3.5 h-3.5" />,
          shortcut: "F2",
          disabled: multi,
          separatorBefore: true,
          onSelect: () => onRename(entry),
        },
        {
          id: "copy",
          label: t.plugins.drive.ctx_copy,
          icon: <Copy className="w-3.5 h-3.5" />,
          shortcut: "Ctrl+C",
          onSelect: () => drive.copySelection(),
        },
        {
          id: "cut",
          label: t.plugins.drive.ctx_cut,
          icon: <Scissors className="w-3.5 h-3.5" />,
          shortcut: "Ctrl+X",
          onSelect: () => drive.cutSelection(),
        },
        // Paste lives in the entry context too — it always targets the current
        // folder via pasteHere(), so it is relevant regardless of which row was
        // right-clicked. Matches Finder / Explorer.
        {
          id: "paste",
          label: t.plugins.drive.ctx_paste,
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          shortcut: "Ctrl+V",
          disabled: !drive.clipboard,
          onSelect: () => drive.pasteHere(),
        },
        {
          id: "copy-path",
          label: t.plugins.drive.ctx_copy_path,
          icon: <LinkIcon className="w-3.5 h-3.5" />,
          onSelect: () => onCopyPath(entry),
        },
        ...(entry.kind === "file"
          ? [
              {
                id: "sign",
                label: t.plugins.drive.ctx_sign_file,
                icon: <FileSignature className="w-3.5 h-3.5" />,
                disabled: multi,
                separatorBefore: true,
                onSelect: () => onSignFile(entry),
              },
              {
                id: "verify",
                label: t.plugins.drive.ctx_verify_file,
                icon: <ShieldCheck className="w-3.5 h-3.5" />,
                disabled: multi,
                onSelect: () => onVerifyFile(entry),
              },
              ...(isOcrEligible(entry.mime, entry.extension)
                ? [
                    {
                      id: "extract",
                      label: hasGemini
                        ? t.plugins.drive.ctx_extract_text
                        : t.plugins.drive.ctx_extract_text_no_gemini,
                      icon: <ScanLine className="w-3.5 h-3.5" />,
                      disabled: !hasGemini || multi,
                      onSelect: () => onExtractText(entry),
                    },
                  ]
                : []),
            ]
          : []),
        ...(knowledgeAvailable
          ? [
              {
                id: "kb-add",
                label: t.plugins.drive.kb_add_to,
                icon: <Brain className="w-3.5 h-3.5" />,
                separatorBefore: true,
                onSelect: () => onAddToKnowledge(entry),
              },
              {
                id: "kb-open",
                label: t.plugins.drive.kb_open,
                icon: <Sparkles className="w-3.5 h-3.5" />,
                onSelect: onOpenKnowledge,
              },
            ]
          : []),
        {
          id: "delete",
          label: t.plugins.drive.ctx_delete,
          icon: <Trash2 className="w-3.5 h-3.5" />,
          shortcut: "Del",
          danger: true,
          separatorBefore: true,
          onSelect: () => onRequestDelete(paths),
        },
      ]
    : [
        {
          id: "new-folder",
          label: t.plugins.drive.ctx_new_folder,
          icon: <FolderPlus className="w-3.5 h-3.5" />,
          onSelect: onNewFolder,
        },
        {
          id: "new-file",
          label: t.plugins.drive.ctx_new_file,
          icon: <FilePlus className="w-3.5 h-3.5" />,
          onSelect: onNewFile,
        },
        {
          id: "paste",
          label: t.plugins.drive.ctx_paste,
          icon: <ClipboardPaste className="w-3.5 h-3.5" />,
          shortcut: "Ctrl+V",
          disabled: !drive.clipboard,
          separatorBefore: true,
          onSelect: () => drive.pasteHere(),
        },
        ...(knowledgeAvailable
          ? [
              // Null entry = the open folder, which is the folder-scoped
              // "ask across these documents" case.
              {
                id: "kb-add-folder",
                label: t.plugins.drive.kb_add_folder,
                icon: <Brain className="w-3.5 h-3.5" />,
                separatorBefore: true,
                onSelect: () => onAddToKnowledge(null),
              },
              {
                id: "kb-open",
                label: t.plugins.drive.kb_open,
                icon: <Sparkles className="w-3.5 h-3.5" />,
                onSelect: onOpenKnowledge,
              },
            ]
          : []),
      ];

  return <ContextMenu x={state.x} y={state.y} onClose={onClose} items={items} />;
}
