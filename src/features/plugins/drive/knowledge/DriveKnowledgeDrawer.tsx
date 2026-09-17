import { useCallback, useEffect, useState } from "react";
import { Brain, MessageCircleQuestion, Table2, X } from "lucide-react";

import { BaseModal } from "@/features/shared/components/modals";
import { Tooltip } from "@/features/shared/components/display/Tooltip";
import { SearchTab } from "@/features/vault/shared/vector/tabs/SearchTab";
import { ExtractTab } from "@/features/vault/shared/vector/tabs/ExtractTab";
import { useTranslation } from "@/i18n/useTranslation";
import { silentCatch } from "@/lib/silentCatch";
import { useTypedTauriEvent } from "@/hooks/useTauriEvent";
import { EventName } from "@/lib/eventRegistry";
import {
  getKnowledgeBase,
  type KnowledgeBase,
} from "@/api/vault/database/vectorKb";
import type { KbIngestProgressPayload } from "@/lib/eventRegistry";
import { useKbIngestProgress } from "./kbIngestListener";

const TITLE_ID = "drive-knowledge-drawer-title";

type Tab = "ask" | "extract";

interface Props {
  kb: KnowledgeBase;
  /**
   * Top-level entries the caller just handed to the ingest job, if it opened
   * this drawer straight after queueing one. Without it there is a gap between
   * "queued N" and the first progress event in which a brand-new KB is
   * indistinguishable from an empty one.
   */
  queuedCount?: number;
  onClose: () => void;
}

/**
 * Three states, and the middle one is the whole point. `documentCount === 0`
 * used to mean "empty KB" to everything downstream - including ExtractTab -
 * with no way to say "0 so far, 12 of 40 in flight".
 */
type IngestState = "idle" | "running" | "complete";

/**
 * Drive-side host for the knowledge surfaces. Deliberately thin: `SearchTab`
 * and `ExtractTab` are the *same* components the Vault KB modal renders, so
 * Ask and Extract cannot drift between the two entry points. See `./DESIGN.md`.
 */
export function DriveKnowledgeDrawer({ kb: initialKb, queuedCount, onClose }: Props) {
  const { t, tx } = useTranslation();
  const d = t.plugins.drive;
  const [tab, setTab] = useState<Tab>("ask");
  const [kb, setKb] = useState(initialKb);
  const [progress, setProgress] = useState<KbIngestProgressPayload | null>(null);
  // A caller that queued work before opening us starts in `running`, not
  // `idle`: the job IS in flight, the first progress event just has not landed.
  const [ingest, setIngest] = useState<IngestState>(
    queuedCount && queuedCount > 0 ? "running" : "idle",
  );

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
  }, [refreshKb]);

  /* The event `useDriveKnowledge`'s header already names as the one progress
     arrives on, and which nothing in Drive subscribed to.

     Attached through the BUFFERED singleton rather than `useTypedTauriEvent`:
     the unbuffered hook drops everything emitted between mount and the moment
     its subscription resolves, and for a progress stream that window is the
     job's first moments - precisely when the operator is watching to see
     whether anything started (`snapshot-plus-stream`).

     Filtered to THIS kb: another KB's ingest running in the background is not
     this drawer's business and must not move its numbers. */
  useKbIngestProgress(
    useCallback(
      (p: KbIngestProgressPayload) => {
        if (p.kbId !== initialKb.id) return;
        setProgress(p);
        setIngest("running");
      },
      [initialKb.id],
    ),
  );

  useTypedTauriEvent(
    EventName.KB_INGEST_COMPLETE,
    useCallback(
      (p: KbIngestProgressPayload) => {
        if (p.kbId !== initialKb.id) return;
        setProgress(p);
        setIngest("complete");
        refreshKb();
      },
      [initialKb.id, refreshKb],
    ),
    "DriveKnowledgeDrawer:ingestComplete",
  );

  /* Extract over a KB that has nothing in it yet reads the count as "empty" and
     says so. While a job is running that claim is wrong, so the tab waits -
     and ONLY while the count is still zero, because a KB with documents is
     answerable even as more arrive. */
  const extractBlocked = ingest === "running" && kb.documentCount === 0;
  useEffect(() => {
    if (extractBlocked && tab === "extract") setTab("ask");
  }, [extractBlocked, tab]);

  const tabButton = (id: Tab, label: string, Icon: typeof Brain) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      disabled={id === "extract" && extractBlocked}
      data-testid={`drive-kb-tab-${id}`}
      onClick={() => setTab(id)}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-body font-medium transition-colors focus-ring ${
        tab === id
          ? "bg-violet-500/20 border border-violet-500/45 text-violet-50"
          : "border border-transparent text-foreground hover:bg-secondary/50"
      } disabled:opacity-40 disabled:cursor-not-allowed`}
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
              <div className="typo-caption text-foreground" data-testid="drive-kb-docs">
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
          {/* The in-flight strip. It sits UNDER the permanent header rather
              than replacing it, so a running job never hides the KB it is
              filling (async-ui-states, law 1). */}
          {ingest !== "idle" && (
            <div
              className="mt-3"
              data-testid="drive-kb-ingest-strip"
              data-ingest={ingest}
              data-done={progress?.documentsDone ?? ''}
              data-total={progress?.documentsTotal ?? queuedCount ?? ''}
            >
              <div className="flex items-center gap-2 typo-caption">
                <span className="text-foreground">
                  {ingest === "complete"
                    ? d.kb_ingest_complete
                    : progress
                      ? tx(d.kb_ingest_progress_n, {
                          done: progress.documentsDone,
                          total: progress.documentsTotal,
                        })
                      : tx(d.kb_ingest_queued_n, { count: queuedCount ?? 0 })}
                </span>
                {ingest === "running" && progress?.currentFile && (
                  <Tooltip content={progress.currentFile}>
                    <span className="min-w-0 truncate text-foreground">{progress.currentFile}</span>
                  </Tooltip>
                )}
              </div>
              {ingest === "running" && progress && progress.documentsTotal > 0 && (
                <div
                  className="mt-1.5 h-1 rounded-full bg-secondary/40 overflow-hidden"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={progress.documentsTotal}
                  aria-valuenow={progress.documentsDone}
                >
                  <div
                    className="h-full bg-violet-400 transition-[width] duration-300"
                    style={{
                      width: `${Math.round((progress.documentsDone / progress.documentsTotal) * 100)}%`,
                    }}
                  />
                </div>
              )}
            </div>
          )}

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
