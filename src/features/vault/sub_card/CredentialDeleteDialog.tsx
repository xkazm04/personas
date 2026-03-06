import { AlertTriangle, Undo2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { CredentialMetadata } from '@/lib/types/types';

export interface DeleteConfirmState {
  credential: CredentialMetadata;
  eventCount: number;
  eventCountVerified?: boolean;
}

export interface UndoToastState {
  credentialId: string;
  credentialName: string;
  remaining: number;
}

export interface CredentialDeleteDialogProps {
  deleteConfirm: DeleteConfirmState | null;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  undoToast: UndoToastState | null;
  onUndo: () => void;
}

export function CredentialDeleteDialog({
  deleteConfirm,
  onConfirmDelete,
  onCancelDelete,
  undoToast,
  onUndo,
}: CredentialDeleteDialogProps) {
  return (
    <>
      {/* Delete Confirmation Dialog */}
      <BaseModal
        isOpen={!!deleteConfirm}
        onClose={onCancelDelete}
        titleId="delete-dialog-title"
        maxWidthClass="max-w-sm"
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-2xl overflow-hidden"
      >
        {deleteConfirm && (
          <div className="p-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/25 flex items-center justify-center flex-shrink-0">
                <AlertTriangle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 id="delete-dialog-title" className="text-sm font-semibold text-foreground/90">Delete Credential</h3>
                <p className="text-sm text-muted-foreground/90 mt-1">This action cannot be undone after the undo window expires.</p>
              </div>
            </div>

            <div className="bg-secondary/40 border border-primary/10 rounded-xl p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono uppercase text-muted-foreground/80">Name</span>
                <span className="text-sm text-foreground/80">{deleteConfirm.credential.name}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm font-mono uppercase text-muted-foreground/80">Type</span>
                <span className="text-sm font-mono text-muted-foreground/80">{deleteConfirm.credential.service_type}</span>
              </div>
              {deleteConfirm.eventCount > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm font-mono uppercase text-muted-foreground/80">Event triggers</span>
                  <span className="text-sm font-medium text-amber-400">
                    {deleteConfirm.eventCount} will be removed
                  </span>
                </div>
              )}
              {deleteConfirm.eventCountVerified === false && (
                <div className="text-sm text-amber-300/90">
                  Could not verify event trigger count. Deletion may impact active automations.
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={onCancelDelete}
                className="px-4 py-2 text-sm text-muted-foreground/80 hover:text-foreground/95 rounded-xl hover:bg-secondary/40 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmDelete}
                className="px-4 py-2 text-sm font-medium rounded-xl bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        )}
      </BaseModal>

      {/* Undo Toast */}
      <AnimatePresence>
        {undoToast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50"
          >
            <div className="flex items-center gap-3 px-4 py-3 bg-background border border-primary/15 rounded-xl shadow-2xl">
              <span className="text-sm text-foreground/80">
                Deleting <span className="font-medium">{undoToast.credentialName}</span> in {undoToast.remaining}s
              </span>
              <button
                onClick={onUndo}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-xl bg-amber-500/20 text-amber-300 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                <Undo2 className="w-3.5 h-3.5" />
                Undo
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
