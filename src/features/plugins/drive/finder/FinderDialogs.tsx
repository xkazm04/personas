import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";

import { DriveConfirm } from "../components/DrivePrompt";
import { DriveKnowledgeDrawer } from "../knowledge/DriveKnowledgeDrawer";
import { KbPickerDialog } from "../knowledge/KbPickerDialog";
import type { UseDriveKnowledgeResult } from "../knowledge/useDriveKnowledge";
import { DriveOcrDrawer } from "../ocr/DriveOcrDrawer";
import type { useOcr } from "../ocr/useOcr";
import { DriveSignDialog } from "../signing/DriveSignDialog";
import { DriveSignaturesPanel } from "../signing/DriveSignaturesPanel";
import { DriveVerifyDialog } from "../signing/DriveVerifyDialog";
import type { useSigning } from "../signing/useSigning";
import { FinderDeleteBreakdown } from "./FinderDeleteBreakdown";
import { FinderMoveTo } from "./toolbar/FinderMoveTo";
import type { DriveApi } from "./types";
import type { FinderDialogsApi } from "./useFinderDialogs";
import type { FinderKnowledgeApi } from "./useFinderKnowledge";

interface Props {
  drive: DriveApi;
  signing: ReturnType<typeof useSigning>;
  ocr: ReturnType<typeof useOcr>;
  knowledge: UseDriveKnowledgeResult;
  dialogs: FinderDialogsApi;
  kb: FinderKnowledgeApi;
}

/** Every modal / drawer the Finder can open, wired exactly like classic. */
export function FinderDialogs({ drive, signing, ocr, knowledge, dialogs, kb }: Props) {
  const { t, tx } = useTranslation();
  const d = t.plugins.drive;
  return (
    <>
      <FinderMoveTo drive={drive} anchor={dialogs.moveToAnchor} onClose={dialogs.closeMoveTo} />
      {kb.kbPicker && (
        <KbPickerDialog
          knowledge={knowledge}
          mode={kb.kbPicker.mode}
          targetLabel={kb.kbPicker.label}
          onPick={(picked) => void kb.handleKbPicked(picked)}
          onClose={kb.closeKbPicker}
        />
      )}
      {kb.knowledgeKb && <DriveKnowledgeDrawer kb={kb.knowledgeKb} queuedCount={kb.queuedForKb} onClose={kb.closeKnowledgeKb} />}
      {dialogs.ocrEntry && (
        <DriveOcrDrawer
          entry={dialogs.ocrEntry}
          ocr={ocr}
          onClose={() => dialogs.setOcrEntry(null)}
          onFileWritten={() => drive.refresh()}
        />
      )}
      {dialogs.signEntry && (
        <DriveSignDialog
          entry={dialogs.signEntry}
          signing={signing}
          onClose={() => dialogs.setSignEntry(null)}
          onSidecarWritten={() => {
            drive.refresh();
            signing.refreshSignatures().catch(silentCatch("finder:signatures-refresh"));
          }}
        />
      )}
      {dialogs.verifyEntry && (
        <DriveVerifyDialog
          entry={dialogs.verifyEntry}
          signing={signing}
          onClose={() => dialogs.setVerifyEntry(null)}
        />
      )}
      {dialogs.signaturesOpen && (
        <DriveSignaturesPanel
          signing={signing}
          onClose={() => dialogs.setSignaturesOpen(false)}
          onRevealInDrive={dialogs.revealInDrive}
        />
      )}
      {dialogs.dialog?.kind === "emptyTrash" && (
        <DriveConfirm
          title={tx(d.trash_empty_confirm_title, { count: drive.entries.length })}
          body={d.trash_empty_confirm_body}
          danger
          onConfirm={() => void dialogs.confirmEmptyTrash()}
          onCancel={dialogs.closeDialog}
        />
      )}
      {dialogs.dialog?.kind === "delete" && (
        <DriveConfirm
          title={tx(d.delete_confirm_title, { count: dialogs.dialog.paths.length })}
          body={
            <div className="space-y-3">
              <FinderDeleteBreakdown paths={dialogs.dialog.paths} entries={drive.entries} />
              <div>{d.delete_confirm_body}</div>
            </div>
          }
          danger
          onConfirm={() => void dialogs.confirmDelete()}
          onCancel={dialogs.closeDialog}
        />
      )}
    </>
  );
}
