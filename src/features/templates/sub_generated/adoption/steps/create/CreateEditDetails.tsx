import { type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { DraftEditStep } from '@/features/shared/components/editors/draft-editor/DraftEditStep';
import type { N8nPersonaDraft } from '@/api/templates/n8nTransform';

interface TabDef {
  id: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  content: ReactNode;
}

interface CreateEditDetailsProps {
  showEditInline: boolean;
  onToggle: () => void;
  draft: N8nPersonaDraft;
  draftJson: string;
  draftJsonError: string | null;
  adjustmentRequest: string;
  transforming: boolean;
  confirming: boolean;
  updateDraft: (updater: (d: N8nPersonaDraft) => N8nPersonaDraft) => void;
  onDraftUpdated: (d: N8nPersonaDraft) => void;
  onJsonEdited: (json: string, draft: N8nPersonaDraft | null, error: string | null) => void;
  onAdjustmentChange: (v: string) => void;
  onApplyAdjustment: () => void;
  earlyTabs: TabDef[];
  additionalTabs: TabDef[];
  motionConfig: { framer: Record<string, unknown> };
}

export function CreateEditDetails({
  showEditInline,
  onToggle,
  draft,
  draftJson,
  draftJsonError,
  adjustmentRequest,
  transforming,
  confirming,
  updateDraft,
  onDraftUpdated,
  onJsonEdited,
  onAdjustmentChange,
  onApplyAdjustment,
  earlyTabs,
  additionalTabs,
  motionConfig,
}: CreateEditDetailsProps) {
  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-center gap-2 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors w-full py-1.5"
      >
        {showEditInline ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>Edit Details</span>
      </button>

      <AnimatePresence>
        {showEditInline && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={motionConfig.framer}
            className="overflow-hidden"
          >
            <div className="min-h-[400px] rounded-xl border border-primary/10 bg-secondary/10 p-4">
              <DraftEditStep
                draft={draft}
                draftJson={draftJson}
                draftJsonError={draftJsonError}
                adjustmentRequest={adjustmentRequest}
                transforming={transforming}
                disabled={confirming}
                updateDraft={updateDraft}
                onDraftUpdated={onDraftUpdated}
                onJsonEdited={onJsonEdited}
                onAdjustmentChange={onAdjustmentChange}
                onApplyAdjustment={onApplyAdjustment}
                earlyTabs={earlyTabs}
                additionalTabs={additionalTabs}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
