import { SortableHeader } from "@/features/shared/components/display/SortableHeader";
import { useTranslation } from "@/i18n/useTranslation";
import type { SortKey } from "../../hooks/useDrive";
import type { DriveApi } from "../types";
import { HEADER_H } from "./listGrouping";

/** One grid template for header, rows, phantom row and ghosts — the swap moves nothing. */
export const LIST_GRID =
  "grid grid-cols-[minmax(0,1fr)_96px_120px_140px_56px] gap-3 px-3 items-center";

const COLUMNS: Array<{ key: SortKey; label: (f: FinderStrings) => string; align: "left" | "right" }> = [
  { key: "name", label: (f) => f.col_name, align: "left" },
  { key: "size", label: (f) => f.col_size, align: "right" },
  { key: "kind", label: (f) => f.col_kind, align: "left" },
  { key: "modified", label: (f) => f.col_modified, align: "left" },
];

type FinderStrings = ReturnType<typeof useTranslation>["t"]["plugins"]["drive"]["finder"];

/** Sticky column header over the engine's sort state. Static chrome (law 5). */
export function ListHeader({ drive }: { drive: DriveApi }) {
  const { t } = useTranslation();
  const f = t.plugins.drive.finder;
  return (
    <div
      role="row"
      className={`${LIST_GRID} sticky top-0 z-20 border-b border-border bg-background`}
      style={{ height: HEADER_H }}
      data-testid="finder-list-header"
    >
      {COLUMNS.map((col) => (
        <SortableHeader
          key={col.key}
          as="div"
          padding="py-0"
          align={col.align}
          label={col.label(f)}
          active={drive.sortKey === col.key}
          dir={drive.sortDir}
          onSort={() => drive.setSort(col.key)}
          className="min-w-0"
          buttonClassName="typo-label"
        />
      ))}
      <div className="typo-label text-foreground" role="columnheader">
        {f.col_tags}
      </div>
    </div>
  );
}
