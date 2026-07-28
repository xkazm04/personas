import { useState } from "react";
import { Brain, Plus, X } from "lucide-react";

import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import type { KnowledgeBase } from "@/api/vault/database/vectorKb";

import type { UseDriveKnowledgeResult } from "./useDriveKnowledge";

const TITLE_ID = "drive-kb-picker-title";

interface Props {
  knowledge: UseDriveKnowledgeResult;
  /** What the pick is for — only changes the subtitle copy. */
  mode: "ingest" | "open";
  /** Human label for what was selected, e.g. "3 items" or a file name. */
  targetLabel: string;
  onPick: (kb: KnowledgeBase) => void;
  onClose: () => void;
}

export function KbPickerDialog({
  knowledge,
  mode,
  targetLabel,
  onPick,
  onClose,
}: Props) {
  const { t, tx } = useTranslation();
  const d = t.plugins.drive;
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [pending, setPending] = useState(false);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name || pending) return;
    setPending(true);
    try {
      onPick(await knowledge.create(name));
    } catch (err) {
      toastCatch("drive:knowledge:create")(err);
      setPending(false);
    }
  };

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} size="md" portal>
      <div className="contents">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="w-9 h-9 rounded-card bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
            <Brain className="w-4.5 h-4.5 text-violet-200" />
          </div>
          <div className="flex-1 min-w-0">
            <div id={TITLE_ID} className="typo-section-title">
              {mode === "ingest" ? d.kb_picker_title_ingest : d.kb_picker_title_open}
            </div>
            <div className="typo-caption text-foreground truncate">
              {tx(d.kb_picker_subtitle, { target: targetLabel })}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-input text-foreground hover:bg-secondary/60 transition-colors focus-ring"
            aria-label={d.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {knowledge.knowledgeBases.length === 0 && !creating && (
            <p className="typo-body text-foreground py-6 text-center">
              {d.kb_picker_empty}
            </p>
          )}

          {knowledge.knowledgeBases.map((kb) => (
            <button
              key={kb.id}
              type="button"
              disabled={pending}
              onClick={() => onPick(kb)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-card border border-primary/15 bg-secondary/30 hover:bg-secondary/50 hover:border-violet-500/40 transition-colors text-left disabled:opacity-50 focus-ring"
            >
              <Brain className="w-4 h-4 text-violet-200 shrink-0" />
              <span className="flex-1 min-w-0 typo-body font-medium text-foreground truncate">
                {kb.name}
              </span>
              <span className="typo-caption text-foreground tabular-nums shrink-0">
                {tx(d.kb_docs_n, { count: kb.documentCount })}
              </span>
            </button>
          ))}

          {creating ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
                placeholder={d.kb_create_placeholder}
                autoFocus
                className="flex-1 min-w-0 px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-violet-500/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || pending}
                className="flex items-center gap-1.5 px-3 py-2 rounded-input bg-violet-500/20 border border-violet-500/45 typo-body font-semibold text-violet-50 hover:bg-violet-500/30 disabled:opacity-40 transition-colors focus-ring"
              >
                {pending ? <LoadingSpinner className="text-violet-200" /> : null}
                {d.kb_create}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-card border border-dashed border-primary/25 typo-body text-foreground hover:border-violet-500/40 hover:bg-secondary/30 transition-colors focus-ring"
            >
              <Plus className="w-4 h-4 shrink-0" />
              {d.kb_create_new}
            </button>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
