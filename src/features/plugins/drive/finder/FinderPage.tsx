import { useRef, useState } from "react";

import { ContentBox, ContentHeader } from "@/features/shared/components/layout/ContentLayout";
import { ErrorBoundary } from "@/features/shared/components/feedback/ErrorBoundary";
import { IconDrive } from "@/features/plugins/PluginIcons";
import { useTranslation } from "@/i18n/useTranslation";

import { useDrive } from "../hooks/useDrive";
import { useDriveKnowledge } from "../knowledge/useDriveKnowledge";
import { useOcr } from "../ocr/useOcr";
import { useSigning } from "../signing/useSigning";
import { FinderContextMenu, type FinderMenuState } from "./FinderContextMenu";
import { FinderDialogs } from "./FinderDialogs";
import { FinderHeaderActions } from "./FinderHeaderActions";
import { FinderMain } from "./FinderMain";
import { Inspector } from "./inspector/Inspector";
import { QuickLook } from "./quicklook/QuickLook";
import { SplitPane } from "./shell/SplitPane";
import { FinderSidebar } from "./sidebar/FinderSidebar";
import type { FinderViewProps } from "./types";
import { useDriveMeta } from "./useDriveMeta";
import { useExternalDrop } from "./useExternalDrop";
import { useFinderDialogs } from "./useFinderDialogs";
import { useFinderEditing } from "./useFinderEditing";
import { useFinderKeyBindings } from "./useFinderKeyBindings";
import { useFinderKnowledge } from "./useFinderKnowledge";
import { useFinderPrefs } from "./useFinderPrefs";
import { useFinderTransfers } from "./useFinderTransfers";
import { useQuickLook } from "./useQuickLook";
import { useTaggedView } from "./useTaggedView";

/**
 * Finder shell — the Drive renderer over the ONE Drive engine. Owns no
 * data of its own: every hook below is the shared engine (useDrive, signing,
 * OCR, knowledge); this file only composes the three panes and routes actions.
 */
export default function FinderPage() {
  const { t } = useTranslation();
  const drive = useDrive();
  const signing = useSigning();
  const ocr = useOcr();
  const knowledge = useDriveKnowledge();
  const meta = useDriveMeta();
  const prefs = useFinderPrefs();
  const editing = useFinderEditing(drive);
  const transfers = useFinderTransfers(drive);
  const dialogs = useFinderDialogs(drive, signing);
  const kb = useFinderKnowledge(drive, knowledge);
  const tagged = useTaggedView(drive, meta);
  const external = useExternalDrop(drive);
  const quickLook = useQuickLook(drive);

  const searchRef = useRef<HTMLInputElement | null>(null);
  const [menu, setMenu] = useState<FinderMenuState | null>(null);
  const selectedEntries = drive.visibleEntries.filter((e) => drive.selection.has(e.path));
  const knowledgeAvailable = knowledge.available === true;

  useFinderKeyBindings({
    drive,
    prefs,
    editing,
    dialogs,
    transfers,
    searchRef,
    quickLookOpen: quickLook.path !== null,
    toggleQuickLook: quickLook.toggle,
    closeQuickLook: quickLook.close,
  });

  const viewProps: FinderViewProps = {
    drive,
    meta,
    signedPaths: signing.signedPaths,
    onOpen: transfers.handleOpen,
    onContextMenu: (entry, x, y) => setMenu({ entry, x, y }),
    onQuickLook: () => quickLook.open(),
    inlineRenamingPath: editing.inlineRenamingPath,
    onCommitInlineRename: editing.commitInlineRename,
    onCancelInlineRename: editing.cancelInlineRename,
    pendingCreate: editing.pendingCreate,
    onCommitPendingCreate: editing.commitPendingCreate,
    onCancelPendingCreate: editing.cancelPendingCreate,
    activeDragCount: editing.activeDragCount,
    onDragSelectionStart: editing.onDragSelectionStart,
    onDragSelectionEnd: editing.onDragSelectionEnd,
    externalDropPath: external.dropTarget,
    onExternalFolderDragOver: external.setDropTarget,
    onNativeDragOut: transfers.handleNativeDragOut,
    onRequestCreate: editing.requestCreate,
  };

  return (
    <ContentBox>
      <ContentHeader
        icon={<IconDrive active className="w-5 h-5 text-primary" />}
        iconColor="cyan"
        title={t.plugins.drive.title}
        subtitle={t.plugins.drive.subtitle}
        actions={
          <FinderHeaderActions
            drive={drive}
            onRequestDelete={dialogs.requestDeleteSelection}
          />
        }
      />
      <ErrorBoundary name="Drive" onReset={drive.refresh}>
        <SplitPane
          sidebarW={prefs.prefs.sidebarW}
          inspectorW={prefs.prefs.inspectorW}
          sidebarOpen={prefs.prefs.sidebarOpen}
          inspectorOpen={prefs.prefs.inspectorOpen}
          onSidebarW={prefs.setSidebarW}
          onInspectorW={prefs.setInspectorW}
          sidebar={
            <FinderSidebar
              drive={drive}
              meta={meta}
              activeTagId={tagged.tag?.id ?? null}
              activeDragCount={editing.activeDragCount}
              onExternalFolderDragOver={external.setDropTarget}
              onPickTag={tagged.pick}
              onManageTags={() => prefs.setInspectorOpen(true)}
            />
          }
          main={
            <FinderMain
              prefs={prefs}
              viewProps={viewProps}
              searchRef={searchRef}
              transfers={transfers}
              dialogs={dialogs}
              editing={editing}
              tagged={tagged}
              external={external}
            />
          }
          inspector={
            <Inspector
              entries={selectedEntries}
              currentPath={drive.currentPath}
              meta={meta}
              signedPaths={signing.signedPaths}
              onQuickLook={quickLook.open}
              onOpen={transfers.handleOpen}
              onReveal={transfers.handleReveal}
              onSign={dialogs.setSignEntry}
              onVerify={dialogs.setVerifyEntry}
              onExtractText={dialogs.setOcrEntry}
              hasGemini={ocr.hasGemini}
              onKnowledge={kb.handleAddToKnowledge}
              knowledgeAvailable={knowledgeAvailable}
            />
          }
        />
      </ErrorBoundary>

      {menu && (
        <FinderContextMenu
          state={menu}
          drive={drive}
          meta={meta}
          knowledgeAvailable={knowledgeAvailable}
          onClose={() => setMenu(null)}
          onOpen={transfers.handleOpen}
          onQuickLook={quickLook.open}
          onReveal={transfers.handleReveal}
          onRename={editing.requestRename}
          onDuplicate={() => void transfers.handleDuplicate()}
          onCopyPath={transfers.handleCopyPath}
          onExport={() => void transfers.handleExport()}
          onMoveTo={dialogs.openMoveTo}
          onSign={dialogs.setSignEntry}
          onVerify={dialogs.setVerifyEntry}
          onExtractText={dialogs.setOcrEntry}
          hasGemini={ocr.hasGemini}
          onRequestDelete={dialogs.requestDelete}
          onRestore={() => void dialogs.restoreSelection()}
          onNewFolder={editing.requestNewFolder}
          onNewFile={editing.requestNewFile}
          onAddToKnowledge={kb.handleAddToKnowledge}
          onOpenKnowledge={kb.handleOpenKnowledge}
        />
      )}
      {quickLook.path && (
        <QuickLook
          entries={quickLook.previewable}
          initialPath={quickLook.path}
          onClose={quickLook.close}
          onStep={drive.selectOnly}
          onOpenInOs={transfers.handleOpen}
        />
      )}
      <FinderDialogs drive={drive} signing={signing} ocr={ocr} knowledge={knowledge} dialogs={dialogs} kb={kb} />
    </ContentBox>
  );
}
