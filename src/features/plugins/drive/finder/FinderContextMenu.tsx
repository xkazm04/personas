import {
  Copy,
  CopyPlus,
  Eye,
  ExternalLink,
  FileSignature,
  FolderOpen,
  FolderOutput,
  Link as LinkIcon,
  Move,
  Pencil,
  RotateCcw,
  ScanLine,
  Scissors,
  ShieldCheck,
  ClipboardPaste,
  Trash2,
} from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";
import { ContextMenu, type ContextMenuItem } from "@/features/shared/components/overlays/ContextMenu";

import { isOcrEligible } from "../ocr/useOcr";
import { emptyAreaItems, knowledgeItems, tagItems, type MenuContext } from "./contextMenuItems";
import { TRASH_PATH } from "./sidebar/LocationsSection";
import { previewKind } from "./types";

export interface FinderMenuState {
  x: number;
  y: number;
  entry: DriveEntry | null;
}

interface Props extends Omit<MenuContext, "t"> {
  state: FinderMenuState;
  onClose: () => void;
  onOpen: (entry: DriveEntry) => void;
  onQuickLook: (entry: DriveEntry) => void;
  onReveal: (entry: DriveEntry) => void;
  onRename: (entry: DriveEntry) => void;
  onDuplicate: () => void;
  onCopyPath: (entry: DriveEntry) => void;
  onExport: () => void;
  /** Receives the menu point as an anchor; the row is selected first if it was not. */
  onMoveTo: (anchor: DOMRect) => void;
  onSign: (entry: DriveEntry) => void;
  onVerify: (entry: DriveEntry) => void;
  onExtractText: (entry: DriveEntry) => void;
  hasGemini: boolean;
  onRequestDelete: (paths: string[]) => void;
  onRestore: () => void;
}

const ic = "w-3.5 h-3.5";

/**
 * Item set over the shared ContextMenu. A right-click on a row inside a
 * multi-selection acts on the whole selection (classic rule); in `.trash`
 * the destructive tail becomes Put back + Delete permanently.
 */
export function FinderContextMenu(p: Props) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const { entry } = p.state;
  const ctx: MenuContext = { ...p, t };
  const drive = p.drive;
  const inTrash = drive.currentPath === TRASH_PATH || drive.currentPath.startsWith(`${TRASH_PATH}/`);

  let items: ContextMenuItem[];
  if (!entry) {
    items = emptyAreaItems(ctx);
  } else {
    const inSel = drive.selection.has(entry.path);
    const paths = inSel && drive.selection.size > 0 ? Array.from(drive.selection) : [entry.path];
    const multi = paths.length > 1;
    const isFile = entry.kind === "file";
    items = [
      { id: "open", label: f.ctx_open, icon: <ExternalLink className={ic} />, shortcut: "Enter", onSelect: () => p.onOpen(entry) },
      {
        id: "quicklook",
        label: f.ctx_quick_look,
        icon: <Eye className={ic} />,
        shortcut: f.kbd_hint_space,
        disabled: previewKind(entry) === null,
        onSelect: () => p.onQuickLook(entry),
      },
      { id: "reveal", label: f.ctx_reveal, icon: <FolderOpen className={ic} />, onSelect: () => p.onReveal(entry) },
      { id: "rename", label: f.ctx_rename, icon: <Pencil className={ic} />, shortcut: "F2", disabled: multi, separatorBefore: true, onSelect: () => p.onRename(entry) },
      { id: "duplicate", label: f.ctx_duplicate, icon: <CopyPlus className={ic} />, shortcut: "Ctrl+D", onSelect: p.onDuplicate },
      { id: "copy", label: f.ctx_copy, icon: <Copy className={ic} />, shortcut: "Ctrl+C", onSelect: () => drive.copySelection() },
      { id: "cut", label: f.ctx_cut, icon: <Scissors className={ic} />, shortcut: "Ctrl+X", onSelect: () => drive.cutSelection() },
      { id: "paste", label: f.ctx_paste, icon: <ClipboardPaste className={ic} />, shortcut: "Ctrl+V", disabled: !drive.clipboard, onSelect: () => void drive.pasteHere() },
      { id: "copy-path", label: f.ctx_copy_path, icon: <LinkIcon className={ic} />, onSelect: () => p.onCopyPath(entry) },
      {
        id: "move-to",
        label: f.move_to,
        icon: <Move className={ic} />,
        onSelect: () => {
          if (!inSel) drive.selectOnly(entry.path);
          p.onMoveTo(new DOMRect(p.state.x, p.state.y, 1, 1));
        },
      },
      { id: "export", label: f.ctx_export, icon: <FolderOutput className={ic} />, shortcut: "Ctrl+Shift+E", onSelect: p.onExport },
      ...tagItems(ctx, paths),
      ...(isFile
        ? [
            { id: "sign", label: f.ctx_sign, icon: <FileSignature className={ic} />, disabled: multi, separatorBefore: true, onSelect: () => p.onSign(entry) },
            { id: "verify", label: f.ctx_verify, icon: <ShieldCheck className={ic} />, disabled: multi, onSelect: () => p.onVerify(entry) },
            ...(isOcrEligible(entry.mime, entry.extension)
              ? [
                  {
                    id: "extract",
                    label: p.hasGemini ? f.ctx_extract_text : f.ctx_extract_text_needs_gemini,
                    icon: <ScanLine className={ic} />,
                    disabled: !p.hasGemini || multi,
                    onSelect: () => p.onExtractText(entry),
                  },
                ]
              : []),
          ]
        : []),
      ...knowledgeItems(ctx, entry),
      ...(inTrash
        ? [
            { id: "restore", label: f.ctx_restore, icon: <RotateCcw className={ic} />, separatorBefore: true, onSelect: p.onRestore },
            { id: "delete-forever", label: f.ctx_delete_forever, icon: <Trash2 className={ic} />, danger: true, onSelect: () => p.onRequestDelete(paths) },
          ]
        : [
            { id: "delete", label: f.ctx_delete, icon: <Trash2 className={ic} />, shortcut: "Del", danger: true, separatorBefore: true, onSelect: () => p.onRequestDelete(paths) },
          ]),
    ];
  }

  return <ContextMenu x={p.state.x} y={p.state.y} items={items} onClose={p.onClose} />;
}
