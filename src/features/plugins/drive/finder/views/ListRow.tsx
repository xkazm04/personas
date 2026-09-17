import { useRef } from "react";
import type { CSSProperties } from "react";
import { File as FileIcon, FileSignature, Folder as FolderIcon } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import { Numeric } from "@/features/shared/components/display/Numeric";
import { RelativeTime } from "@/features/shared/components/display/RelativeTime";
import { TruncateWithTooltip } from "@/features/shared/components/display/TruncateWithTooltip";
import { useTranslation } from "@/i18n/useTranslation";
import { trashEntryInfo } from "../../designTokens";
import type { FinderViewProps } from "../types";
import { InlineNameInput } from "./InlineNameInput";
import { LIST_GRID } from "./ListHeader";
import { ROW_H } from "./listGrouping";
import { kindLabelFor, kindVisual } from "./kindVisual";
import { entryStateClass, selectByClick, selectForContextMenu } from "./selection";
import { TagDots } from "./TagDots";
import type { EntryDnD } from "./useEntryDnD";
import { useThumbnail } from "./useThumbnail";

/** Days-until-purge chip on a `.trash` row, warning-tinted inside the last day. */
function TrashChip({ purgeAt }: { purgeAt: number }) {
  const { t, tx } = useTranslation();
  const daysLeft = Math.ceil((purgeAt - Date.now()) / 86_400_000);
  const soon = daysLeft <= 1;
  return (
    <span
      className={`inline-flex items-center px-1.5 rounded-interactive typo-label tabular-nums flex-shrink-0 border ${
        soon
          ? "border-status-warning/40 bg-status-warning/10 text-status-warning"
          : "border-border bg-secondary/30 text-foreground"
      }`}
    >
      {soon
        ? t.plugins.drive.trash_purges_soon
        : tx(t.plugins.drive.trash_purges_in_days, { days: daysLeft })}
    </span>
  );
}

function RowVisual({ entry }: { entry: DriveEntry }) {
  const ref = useRef<HTMLSpanElement>(null);
  const { url } = useThumbnail(entry, 96, ref);
  const { Icon, tint } = kindVisual(entry);
  return (
    <span ref={ref} className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-interactive overflow-hidden">
      {url ? (
        <img src={url} alt="" draggable={false} className="w-8 h-8 object-cover rounded-interactive" />
      ) : (
        <Icon className={`w-4 h-4 ${tint}`} aria-hidden />
      )}
    </span>
  );
}

export function ListRow({
  view,
  entry,
  dnd,
  style,
}: {
  view: FinderViewProps;
  entry: DriveEntry;
  dnd: EntryDnD;
  style?: CSSProperties;
}) {
  const { t } = useTranslation();
  const { drive, meta, signedPaths, inlineRenamingPath } = view;
  const selected = drive.isSelected(entry.path);
  const flash = drive.recentlyWritten.has(entry.path);
  const trash = drive.currentPath === ".trash" ? trashEntryInfo(entry.name) : null;
  const tags = meta.tagsFor(entry.path);
  const renaming = inlineRenamingPath === entry.path;

  return (
    <div
      role="row"
      aria-selected={selected}
      data-testid="finder-list-row"
      data-path={entry.path}
      style={{ height: ROW_H, ...style }}
      {...dnd.handlers(entry)}
      onClick={(e) => selectByClick(drive, entry, e)}
      onDoubleClick={() => view.onOpen(entry)}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        selectForContextMenu(drive, entry);
        view.onContextMenu(entry, e.clientX, e.clientY);
      }}
      className={`${LIST_GRID} border-b border-border/60 cursor-default transition-colors duration-150 ${entryStateClass(
        selected,
        flash,
      )} ${dnd.dropClass(entry)}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <RowVisual entry={entry} />
        {renaming ? (
          <InlineNameInput
            initialName={entry.name}
            className="flex-1"
            onCommit={(name) => view.onCommitInlineRename(entry.path, name)}
            onCancel={view.onCancelInlineRename}
          />
        ) : (
          <>
            <TruncateWithTooltip
              text={trash?.originalName ?? entry.name}
              className="typo-body text-foreground flex-1 min-w-0"
            />
            {trash?.purgeAt != null && <TrashChip purgeAt={trash.purgeAt} />}
            {signedPaths.has(entry.path) && (
              <FileSignature
                className="w-3.5 h-3.5 text-primary flex-shrink-0"
                aria-label={t.plugins.drive.signed}
              />
            )}
          </>
        )}
      </div>
      <Numeric className="typo-body text-foreground text-right">
        {entry.kind === "folder" ? "—" : driveFormatBytes(entry.size)}
      </Numeric>
      <div className="typo-body text-foreground truncate">{kindLabelFor(t, entry)}</div>
      <RelativeTime timestamp={entry.modified} className="typo-body text-foreground tabular-nums" />
      <TagDots tags={tags} />
    </div>
  );
}

/** Phantom row for a pending create, kind-styled by intent, above the real rows. */
export function PhantomRow({
  kind,
  onCommit,
  onCancel,
}: {
  kind: "folder" | "file";
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const Icon = kind === "folder" ? FolderIcon : FileIcon;
  return (
    <div
      role="row"
      data-testid="finder-phantom-row"
      style={{ height: ROW_H }}
      className={`${LIST_GRID} border-b border-primary/25 bg-primary/5`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-8 h-8 flex-shrink-0 flex items-center justify-center">
          <Icon className={`w-4 h-4 ${kind === "folder" ? "text-primary" : "text-foreground"}`} />
        </span>
        <InlineNameInput initialName="" className="flex-1" onCommit={onCommit} onCancel={onCancel} />
      </div>
      <div className="typo-body text-foreground text-right">—</div>
      <div className="typo-body text-foreground">
        {kind === "folder" ? t.plugins.drive.kind_folder : t.plugins.drive.kind_generic}
      </div>
      <div className="typo-body text-foreground">—</div>
      <div />
    </div>
  );
}
