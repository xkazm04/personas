import { ArrowLeft, ArrowUpRight, Search } from "lucide-react";

import type { DriveSearchHit } from "@/api/drive";
import { driveParentPath } from "@/api/drive";
import { Button } from "@/features/shared/components/buttons";
import { TruncateWithTooltip } from "@/features/shared/components/display/TruncateWithTooltip";
import ScenarioEmptyState from "@/features/shared/components/feedback/ScenarioEmptyState";
import { useTranslation } from "@/i18n/useTranslation";
import type { DriveApi, FinderViewProps } from "../types";
import { FinderGhost } from "./FinderGhost";
import { FINDER_SCENARIO_BOX, finderScenario, finderScenarioTestId } from "./finderScenario";
import { kindVisual } from "./kindVisual";
import { ROW_H } from "./listGrouping";

/** Navigate to the hit's folder, then select it once the new folder has mounted. */
function revealHit(drive: DriveApi, hit: DriveSearchHit): void {
  const { entry, parentPath } = hit;
  const parent = entry.kind === "folder" ? driveParentPath(entry.path) : parentPath;
  drive.clearRecursiveSearch();
  drive.navigate(parent);
  queueMicrotask(() => drive.selectOnly(entry.path));
}

function ResultRow({ hit, view }: { hit: DriveSearchHit; view: FinderViewProps }) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  const { drive } = view;
  const { entry, parentPath } = hit;
  const { Icon, tint } = kindVisual(entry);
  const selected = drive.isSelected(entry.path);
  return (
    <div
      role="row"
      aria-selected={selected}
      data-testid="finder-recursive-row"
      style={{ minHeight: ROW_H }}
      onClick={() => drive.selectOnly(entry.path)}
      onDoubleClick={() => (entry.kind === "folder" ? revealHit(drive, hit) : view.onOpen(entry))}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selected) drive.selectOnly(entry.path);
        view.onContextMenu(entry, e.clientX, e.clientY);
      }}
      className={`grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-1 items-center border-b border-border/60 cursor-default ${
        selected ? "bg-primary/15 ring-1 ring-primary/40" : "hover:bg-secondary/30"
      }`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <Icon className={`w-4 h-4 flex-shrink-0 ${tint}`} aria-hidden />
        <div className="min-w-0 flex items-center gap-2">
          <TruncateWithTooltip text={entry.name} className="typo-body text-foreground min-w-0" />
          <span className="typo-code px-1.5 rounded-interactive bg-secondary/40 border border-border text-foreground truncate max-w-[16rem]">
            {parentPath || "/"}
          </span>
        </div>
      </div>
      <Button
        variant="ghost"
        size="xs"
        icon={<ArrowUpRight className="w-3.5 h-3.5" />}
        onClick={(e) => {
          e.stopPropagation();
          revealHit(drive, hit);
        }}
      >
        {f.reveal_result}
      </Button>
    </div>
  );
}

/** Drive-wide search results, shown in place of the folder rows. */
export function RecursiveResults({ view }: { view: FinderViewProps }) {
  const { t, tx } = useTranslation();
  const f = t.plugins.drive.finder;
  const { drive } = view;
  const results = drive.recursiveResults ?? [];
  return (
    <div
      role="grid"
      data-testid="finder-recursive-results"
      className="flex-1 min-h-0 overflow-auto bg-background flex flex-col"
    >
      <div className="sticky top-0 z-20 flex items-center justify-between gap-3 px-3 py-2 border-b border-border bg-background">
        <div className="flex items-center gap-2 min-w-0 typo-body text-foreground">
          <Search className="w-3.5 h-3.5 text-primary flex-shrink-0" aria-hidden />
          <span className="truncate">
            {drive.recursiveLoading
              ? f.recursive_loading
              : tx(f.recursive_results_n, { count: results.length })}
          </span>
        </div>
        <Button
          variant="ghost"
          size="xs"
          icon={<ArrowLeft className="w-3.5 h-3.5" />}
          onClick={() => drive.clearRecursiveSearch()}
        >
          {f.recursive_clear}
        </Button>
      </div>
      {drive.recursiveLoading ? (
        <FinderGhost rows={6} />
      ) : results.length === 0 ? (
        <div className={FINDER_SCENARIO_BOX} data-testid={finderScenarioTestId("recursive-empty")}>
          <ScenarioEmptyState {...finderScenario("recursive-empty", { t, tx, drive })} />
        </div>
      ) : (
        results.map((hit) => <ResultRow key={hit.entry.path} hit={hit} view={view} />)
      )}
    </div>
  );
}
