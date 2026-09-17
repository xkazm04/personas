import type { DriveTag } from "@/api/drive";
import { driveFormatBytes } from "@/api/drive";
import { useTranslation } from "@/i18n/useTranslation";

import { useScrollShadows } from "../../hooks/useScrollShadows";
import type { DriveApi, DriveMetaApi } from "../types";
import { LocationsSection } from "./LocationsSection";
import { TagsSection } from "./TagsSection";
import { TreeSection } from "./TreeSection";

interface Props {
  drive: DriveApi;
  meta: DriveMetaApi;
  activeTagId: string | null;
  activeDragCount: number | null;
  onExternalFolderDragOver: (path: string | null) => void;
  onPickTag: (tag: DriveTag) => void;
  onManageTags: () => void;
}

/** Locations · Folders · Tags stacked in a scroll area, storage meter pinned below. */
export function FinderSidebar({
  drive,
  meta,
  activeTagId,
  activeDragCount,
  onExternalFolderDragOver,
  onPickTag,
  onManageTags,
}: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const { ref, topShadow, bottomShadow } = useScrollShadows<HTMLDivElement>();

  return (
    <aside
      className="h-full flex flex-col glass-sm border-r border-border"
      data-testid="finder-sidebar"
      aria-label={f.locations}
    >
      <div className="relative flex-1 min-h-0">
        {topShadow && (
          <div aria-hidden className="absolute inset-x-0 top-0 h-4 z-10 bg-gradient-to-b from-background to-transparent pointer-events-none" />
        )}
        {bottomShadow && (
          <div aria-hidden className="absolute inset-x-0 bottom-0 h-4 z-10 bg-gradient-to-t from-background to-transparent pointer-events-none" />
        )}
        <div ref={ref} className="h-full overflow-y-auto pb-3">
          <LocationsSection drive={drive} />
          <TreeSection
            drive={drive}
            activeDragCount={activeDragCount}
            onExternalFolderDragOver={onExternalFolderDragOver}
          />
          <TagsSection
            meta={meta}
            activeTagId={activeTagId}
            onPickTag={onPickTag}
            onManageTags={onManageTags}
          />
        </div>
      </div>
      {drive.storage && (
        <div
          className="border-t border-border px-4 py-2.5 flex items-center gap-2"
          title={drive.storage.root}
        >
          <span className="typo-caption text-foreground tabular-nums truncate flex-1">
            {tx(f.storage_used, { used: driveFormatBytes(drive.storage.usedBytes) })}
          </span>
          {drive.storage.isDev && (
            <span className="typo-caption px-1.5 rounded-full bg-status-warning/15 text-status-warning">
              {f.storage_dev}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}
