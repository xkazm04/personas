import { Brain, Check, ClipboardPaste, FilePlus, FolderPlus, Sparkles } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import type { Translations } from "@/i18n/useTranslation";
import type { ContextMenuItem } from "@/features/shared/components/overlays/ContextMenu";

import { tagColorClass } from "./tagColor";
import type { DriveApi, DriveMetaApi } from "./types";

const ic = "w-3.5 h-3.5";

export interface MenuContext {
  t: Translations;
  drive: DriveApi;
  meta: DriveMetaApi;
  knowledgeAvailable: boolean;
  onNewFolder: () => void;
  onNewFile: () => void;
  onAddToKnowledge: (entry: DriveEntry | null) => void;
  onOpenKnowledge: () => void;
}

/**
 * Tags block: a disabled header row, then one row per vocab tag (the seven
 * colour labels come first, in vocab order) with a check when every target
 * path already carries it. Selecting toggles the tag on every target.
 */
export function tagItems(ctx: MenuContext, paths: string[]): ContextMenuItem[] {
  const f = ctx.t.plugins.drive.finder;
  const vocab = ctx.meta.meta?.vocab ?? [];
  if (vocab.length === 0) return [];
  const header: ContextMenuItem = {
    id: "tags-header",
    label: f.ctx_tags,
    disabled: true,
    separatorBefore: true,
    onSelect: () => {},
  };
  return [
    header,
    ...vocab.map((tag): ContextMenuItem => {
      const applied = paths.length > 0 && paths.every((p) => ctx.meta.tagsFor(p).some((x) => x.id === tag.id));
      return {
        id: `tag:${tag.id}`,
        label: tag.name,
        icon: (
          <span className="relative inline-flex items-center justify-center w-3.5 h-3.5">
            <span aria-hidden className={`w-2.5 h-2.5 rounded-full ${tagColorClass(tag.color)}`} />
            {applied && <Check className="absolute w-2.5 h-2.5 text-foreground" aria-hidden />}
          </span>
        ),
        onSelect: () => {
          for (const p of paths) void ctx.meta.toggleTag(p, tag.id);
        },
      };
    }),
  ];
}

export function knowledgeItems(ctx: MenuContext, entry: DriveEntry | null): ContextMenuItem[] {
  if (!ctx.knowledgeAvailable) return [];
  const f = ctx.t.plugins.drive.finder;
  return [
    {
      id: "kb-add",
      label: entry ? f.ctx_add_to_kb : f.ctx_add_folder_to_kb,
      icon: <Brain className={ic} />,
      separatorBefore: true,
      onSelect: () => ctx.onAddToKnowledge(entry),
    },
    {
      id: "kb-open",
      label: f.ctx_open_kb,
      icon: <Sparkles className={ic} />,
      onSelect: ctx.onOpenKnowledge,
    },
  ];
}

/** Right-click on empty space: create, paste, knowledge for the open folder. */
export function emptyAreaItems(ctx: MenuContext): ContextMenuItem[] {
  const f = ctx.t.plugins.drive.finder;
  return [
    { id: "new-folder", label: f.ctx_new_folder, icon: <FolderPlus className={ic} />, onSelect: ctx.onNewFolder },
    { id: "new-file", label: f.ctx_new_file, icon: <FilePlus className={ic} />, onSelect: ctx.onNewFile },
    {
      id: "paste",
      label: f.ctx_paste,
      icon: <ClipboardPaste className={ic} />,
      shortcut: "Ctrl+V",
      disabled: !ctx.drive.clipboard,
      separatorBefore: true,
      onSelect: () => void ctx.drive.pasteHere(),
    },
    ...knowledgeItems(ctx, null),
  ];
}
