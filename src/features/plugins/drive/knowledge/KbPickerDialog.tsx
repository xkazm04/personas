import { useState } from "react";
import { Brain, Plus, X } from "lucide-react";

import { BaseModal } from "@/features/shared/components/modals";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";
import type { KnowledgeBase } from "@/api/vault/database/vectorKb";

import type { UseDriveKnowledgeResult } from "./useDriveKnowledge";

import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons';

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
          <div className="w-9 h-9 rounded-card bg-surface-2 border border-hair-2 flex items-center justify-center">
            <Brain className="w-4.5 h-4.5 text-ink-2" />
          </div>
          <div className="flex-1 min-w-0">
            <div id={TITLE_ID} className="typo-section-title">
              {mode === "ingest" ? d.kb_picker_title_ingest : d.kb_picker_title_open}
            </div>
            <div className="typo-caption text-foreground truncate">
              {tx(d.kb_picker_subtitle, { target: targetLabel })}
            </div>
          </div>
          <Button
            type="button"
            onClick={onClose}
            aria-label={d.cancel}
            variant="ghost"
            size="icon-sm"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
          {knowledge.knowledgeBases.length === 0 && !creating && (
            <p className="typo-body text-foreground py-6 text-center">
              {d.kb_picker_empty}
            </p>
          )}

          {knowledge.knowledgeBases.map((kb) => (
            <PressSurface
              key={kb.id}
              disabled={pending}
              onPress={() => onPick(kb)}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-card border border-hair"
            >
              <Brain className="w-4 h-4 text-ink-2 shrink-0" />
              <span className="flex-1 min-w-0 typo-body text-foreground truncate">
                {kb.name}
              </span>
              <span className="typo-caption text-foreground tabular-nums shrink-0">
                {tx(d.kb_docs_n, { count: kb.documentCount })}
              </span>
            </PressSurface>
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
                className="flex-1 min-w-0 px-3 py-2 rounded-input bg-secondary/40 border border-primary/20 typo-body text-foreground placeholder:text-foreground focus:outline-none focus:border-hair-2 transition-colors"
              />
              <Button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newName.trim() || pending}
                variant="ghost"
                size="icon-sm"
              >
                {pending ? <LoadingSpinner className="text-ink-2" /> : null}
                {d.kb_create}
              </Button>
            </div>
          ) : (
            <PressSurface
              onPress={() => setCreating(true)}
              className="w-full flex items-center gap-2 px-3 py-2.5 rounded-card border border-dashed border-hair-2 typo-body"
            >
              <Plus className="w-4 h-4 shrink-0" />
              {d.kb_create_new}
            </PressSurface>
          )}
        </div>
      </div>
    </BaseModal>
  );
}
