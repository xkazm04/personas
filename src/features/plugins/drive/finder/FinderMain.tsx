import type { RefObject } from "react";

import { useTranslation } from "@/i18n/useTranslation";

import { FinderDerivedList } from "./FinderDerivedList";
import { FinderExternalDrop } from "./FinderExternalDrop";
import { FinderTrashBanner } from "./FinderTrashBanner";
import { TRASH_PATH } from "./sidebar/LocationsSection";
import { FinderKindFilter } from "./toolbar/FinderKindFilter";
import { FinderToolbar } from "./toolbar/FinderToolbar";
import type { FinderViewProps } from "./types";
import type { useExternalDrop } from "./useExternalDrop";
import type { FinderDialogsApi } from "./useFinderDialogs";
import type { FinderEditingApi } from "./useFinderEditing";
import type { FinderPrefsApi } from "./useFinderPrefs";
import type { useFinderTransfers } from "./useFinderTransfers";
import type { TaggedViewApi } from "./useTaggedView";
import { ColumnsView } from "./views/ColumnsView";
import { GalleryView } from "./views/GalleryView";
import { IconsView } from "./views/IconsView";
import { ListView } from "./views/ListView";

const VIEWS = { list: ListView, icons: IconsView, columns: ColumnsView, gallery: GalleryView } as const;

interface Props {
  prefs: FinderPrefsApi;
  viewProps: FinderViewProps;
  searchRef: RefObject<HTMLInputElement | null>;
  transfers: ReturnType<typeof useFinderTransfers>;
  dialogs: FinderDialogsApi;
  editing: FinderEditingApi;
  tagged: TaggedViewApi;
  external: ReturnType<typeof useExternalDrop>;
}

/**
 * Toolbar · kind filter · trash banner · (tagged view | the view for
 * `prefs.viewMode`), with the OS-drop overlay on top. Recursive search
 * results are rendered by every view itself (views/RecursiveResults).
 */
export function FinderMain({ prefs, viewProps, searchRef, transfers, dialogs, editing, tagged, external }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const { drive } = viewProps;
  const inTrashRoot = drive.currentPath === TRASH_PATH;
  const View = VIEWS[prefs.prefs.viewMode];

  return (
    <div
      className="relative flex-1 min-h-0 flex flex-col bg-background"
      onDragEnter={external.onDragEnter}
      onDragOver={external.onDragOver}
      onDragLeave={external.onDragLeave}
      onDrop={(e) => void external.onDrop(e)}
      data-testid="finder-main"
    >
      <FinderToolbar
        drive={drive}
        prefs={prefs}
        activeDragCount={viewProps.activeDragCount}
        searchRef={searchRef}
        hasSelection={drive.selection.size > 0}
        pathEditing={editing.pathEditing}
        onPathEditingChange={editing.setPathEditing}
        onImport={() => void transfers.handleImport()}
        onExport={() => void transfers.handleExport()}
        onMoveTo={dialogs.openMoveTo}
        onNewFolder={editing.requestNewFolder}
        onOpenSignatures={() => dialogs.setSignaturesOpen(true)}
      />
      <FinderKindFilter drive={drive} viewMode={prefs.prefs.viewMode} hidden={tagged.tag !== null} />
      {inTrashRoot && (
        <FinderTrashBanner
          itemCount={drive.entries.length}
          selectionCount={drive.selection.size}
          onRestoreSelection={dialogs.restoreSelection}
          onRequestEmpty={dialogs.requestEmptyTrash}
        />
      )}
      {tagged.tag ? (
        <FinderDerivedList
          kind="tagged"
          title={tx(f.tagged_view_title, { tag: tagged.tag.name })}
          count={tagged.entries ? tx(f.items_total_n, { count: tagged.entries.length }) : ""}
          backLabel={f.recursive_clear}
          onBack={tagged.clear}
          entries={tagged.entries}
          emptyTitle={tx(f.tagged_empty_title, { tag: tagged.tag.name })}
          emptyBody={f.tagged_empty_body}
          viewProps={viewProps}
        />
      ) : (
        <View {...viewProps} />
      )}
      <FinderExternalDrop active={external.active} destination={external.dropTarget ?? drive.currentPath} />
    </div>
  );
}
