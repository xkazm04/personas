import { useEffect, useState } from "react";
import { ChevronRight, Clock, HardDrive, Trash2 } from "lucide-react";

import { driveList, driveParentPath } from "@/api/drive";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { Collapse } from "@/features/shared/components/display/Collapse";

import { visualForEntry } from "../../designTokens";
import { MOD_KEY_LABEL } from "../FinderKeymap";
import type { DriveApi } from "../types";

export const TRASH_PATH = ".trash";

const ROW =
  "group w-full flex items-center gap-2 py-1.5 px-2 rounded-input text-left typo-body transition-colors duration-fast focus-ring";
const ROW_IDLE = "text-foreground hover:bg-secondary/50";
const ROW_ACTIVE = "bg-primary/15 ring-1 ring-primary/40 text-foreground";

/** Drive root · Recent (5 files inline, Mod+1..5) · Trash (badge count). */
export function LocationsSection({ drive }: { drive: DriveApi }) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const [recentOpen, setRecentOpen] = useState(true);

  // Trash badge — keyed on drive.storage, which refreshes after every
  // mutation, so the count stays current without its own subscription.
  const [trashCount, setTrashCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    driveList(TRASH_PATH)
      .then((list) => {
        if (!cancelled) setTrashCount(list.length);
      })
      .catch((err: unknown) => {
        silentCatch("finder:trash-count")(err);
        if (!cancelled) setTrashCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [drive.storage]);

  const inTrash = drive.currentPath === TRASH_PATH || drive.currentPath.startsWith(`${TRASH_PATH}/`);
  const atRoot = drive.currentPath === "";
  const recent = drive.recent.slice(0, 5);

  return (
    <section aria-label={f.locations} className="px-2 pt-2">
      <div className="px-2 mb-1 typo-label text-foreground">{f.locations}</div>
      <button
        type="button"
        onClick={() => drive.navigate("")}
        aria-current={atRoot ? "location" : undefined}
        className={`${ROW} ${atRoot ? ROW_ACTIVE : ROW_IDLE}`}
      >
        <HardDrive className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
        <span className="truncate flex-1">{f.location_drive}</span>
      </button>

      <button
        type="button"
        onClick={() => setRecentOpen((v) => !v)}
        aria-expanded={recentOpen}
        className={`${ROW} ${ROW_IDLE}`}
      >
        <ChevronRight
          className={`w-3 h-3 flex-shrink-0 transition-transform duration-fast ${recentOpen ? "rotate-90" : ""}`}
        />
        <Clock className="w-3.5 h-3.5 flex-shrink-0 text-primary" />
        <span className="truncate flex-1">{f.location_recent}</span>
        {recent.length > 0 && (
          <span className="typo-caption tabular-nums text-foreground">{recent.length}</span>
        )}
      </button>
      <Collapse open={recentOpen}>
        <div className="pl-5 pb-1 space-y-0.5">
          {recent.map((entry, idx) => {
            const { Icon, text } = visualForEntry(entry);
            return (
              <button
                key={entry.path}
                type="button"
                title={`${entry.path}\n${MOD_KEY_LABEL}+${idx + 1}`}
                onClick={() => {
                  drive.navigate(driveParentPath(entry.path));
                  // Lands after navigate's state batch (selection clears on nav).
                  queueMicrotask(() => drive.selectOnly(entry.path));
                }}
                className={`${ROW} ${ROW_IDLE}`}
              >
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${text}`} />
                <span className="truncate flex-1">{entry.name}</span>
                <kbd
                  aria-hidden
                  className="typo-caption font-mono px-1 rounded-interactive border border-border bg-secondary/40 text-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-fast"
                >
                  {MOD_KEY_LABEL}+{idx + 1}
                </kbd>
              </button>
            );
          })}
        </div>
      </Collapse>

      <button
        type="button"
        onClick={() => drive.navigate(TRASH_PATH)}
        aria-current={inTrash ? "location" : undefined}
        className={`${ROW} ${inTrash ? "bg-status-error/15 ring-1 ring-status-error/40 text-foreground" : ROW_IDLE}`}
      >
        <Trash2 className="w-3.5 h-3.5 flex-shrink-0 text-status-error" />
        <span className="truncate flex-1">{f.location_trash}</span>
        {trashCount > 0 && (
          <span className="typo-caption tabular-nums text-foreground">{trashCount}</span>
        )}
      </button>
    </section>
  );
}
