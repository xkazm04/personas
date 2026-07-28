import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Brain, MessageCircleQuestion, Table2, X } from "lucide-react";

import { BaseModal } from "@/features/shared/components/modals";
import { SearchTab } from "@/features/vault/shared/vector/tabs/SearchTab";
import { ExtractTab } from "@/features/vault/shared/vector/tabs/ExtractTab";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import {
  getKnowledgeBase,
  type KnowledgeBase,
} from "@/api/vault/database/vectorKb";

const TITLE_ID = "drive-knowledge-drawer-title";

type Tab = "ask" | "extract";

interface Props {
  kb: KnowledgeBase;
  onClose: () => void;
}

/**
 * Drive-side host for the knowledge surfaces. Deliberately thin: `SearchTab`
 * and `ExtractTab` are the *same* components the Vault KB modal renders, so
 * Ask and Extract cannot drift between the two entry points. See `./DESIGN.md`.
 */
export function DriveKnowledgeDrawer({ kb: initialKb, onClose }: Props) {
  const { t, tx } = useTranslation();
  const d = t.plugins.drive;
  const [tab, setTab] = useState<Tab>("ask");
  const [kb, setKb] = useState(initialKb);

  // A drawer opened right after an ingest would otherwise show a stale
  // documentCount of 0 — which ExtractTab reads as "empty KB". Re-read on
  // mount and whenever an ingest job finishes.
  const refreshKb = useCallback(() => {
    getKnowledgeBase(initialKb.id)
      .then(setKb)
      .catch(silentCatch("drive:knowledge:kb-refresh"));
  }, [initialKb.id]);

  useEffect(() => {
    refreshKb();
    let unlisten: (() => void) | undefined;
    void listen("kb:ingest_complete", () => refreshKb()).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [refreshKb]);

  const tabButton = (id: Tab, label: string, Icon: typeof Brain) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-body font-medium transition-colors focus-ring ${
        tab === id
          ? "bg-violet-500/20 border border-violet-500/45 text-violet-50"
          : "border border-transparent text-foreground hover:bg-secondary/50"
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  );

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal>
      <div className="contents">
        <div className="px-5 py-4 border-b border-primary/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-modal bg-violet-500/20 border border-violet-500/45 flex items-center justify-center">
              <Brain className="w-5 h-5 text-violet-100" />
            </div>
            <div className="flex-1 min-w-0">
              <div id={TITLE_ID} className="typo-section-title truncate">
                {kb.name}
              </div>
              <div className="typo-caption text-foreground">
                {tx(d.kb_docs_n, { count: kb.documentCount })}
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
          <div role="tablist" className="flex items-center gap-1.5 mt-3">
            {tabButton("ask", d.kb_tab_ask, MessageCircleQuestion)}
            {tabButton("extract", d.kb_tab_extract, Table2)}
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {tab === "ask" ? <SearchTab kb={kb} /> : <ExtractTab kb={kb} />}
        </div>
      </div>
    </BaseModal>
  );
}
