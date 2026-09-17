import { useMemo, type ReactNode } from "react";
import { ArrowLeft, SearchX, Tag } from "lucide-react";

import type { DriveEntry } from "@/api/drive";
import Button from "@/features/shared/components/buttons/Button";
import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import { resolveErrorTranslated } from "@/i18n/useTranslatedError";

import type { FinderViewProps } from "./types";
import { FINDER_SCENARIO_BOX, finderScenario, finderScenarioTestId } from "./views/finderScenario";
import { ListView } from "./views/ListView";

interface Props {
  /** Header strip: title + count. */
  title: ReactNode;
  count: ReactNode;
  backLabel: string;
  onBack: () => void;
  entries: DriveEntry[] | null;
  /** The rejection behind a failed `entries` fetch: rendered where the list would be, with a Retry. */
  error?: unknown;
  onRetry?: () => void;
  emptyTitle: string;
  emptyBody: string;
  kind: "tagged" | "search";
  viewProps: FinderViewProps;
}

/**
 * A list over entries that are NOT the open folder — the tagged view and the
 * recursive search results. Least-invasive route to reuse the ListView: the
 * view renders `drive.visibleEntries`, so it receives a drive-shaped object
 * whose `visibleEntries` / `entries` are the derived list. Selection, open,
 * context menu and drag all keep working because they are path-keyed.
 * (Documented trade-off: `selectAll` on this object still targets the open
 * folder — the engine owns the selection set.)
 */
export function FinderDerivedList({
  title,
  count,
  backLabel,
  onBack,
  entries,
  error = null,
  onRetry,
  emptyTitle,
  emptyBody,
  kind,
  viewProps,
}: Props) {
  const { t, tx } = useTranslation();
  const failure =
    error == null ? null : resolveErrorTranslated(t, error instanceof Error ? error.message : String(error)).message;
  const derived = useMemo<FinderViewProps>(
    () => ({
      ...viewProps,
      drive: { ...viewProps.drive, visibleEntries: entries ?? [], entries: entries ?? [], loading: entries === null },
    }),
    [viewProps, entries],
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid={`finder-derived-${kind}`}>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/30">
        {kind === "tagged" ? (
          <Tag className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        ) : (
          <SearchX className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
        )}
        <span className="typo-title text-foreground truncate">{title}</span>
        <span className="typo-caption tabular-nums text-foreground">{count}</span>
        <span className="flex-1" />
        <Button variant="ghost" size="xs" icon={<ArrowLeft className="w-3.5 h-3.5" />} onClick={onBack}>
          {backLabel}
        </Button>
      </div>
      {failure !== null ? (
        <div className={FINDER_SCENARIO_BOX} data-testid={finderScenarioTestId("unreadable")}>
          <ScenarioEmptyState {...finderScenario("unreadable", { t, tx, drive: viewProps.drive, error: failure, onRetry })} />
        </div>
      ) : entries !== null && entries.length === 0 ? (
        <div className="flex-1 flex items-center justify-center p-8">
          <ScenarioEmptyState
            icon={kind === "tagged" ? Tag : SearchX}
            title={emptyTitle}
            subtitle={emptyBody}
            action={{ label: backLabel, onClick: onBack, icon: ArrowLeft }}
          />
        </div>
      ) : (
        <ListView {...derived} />
      )}
    </div>
  );
}
