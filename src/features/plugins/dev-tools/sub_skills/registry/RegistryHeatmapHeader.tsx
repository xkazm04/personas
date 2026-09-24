// The heatmap's sticky header row — the app's panel-header language: an
// opaque `bg-background` washed with a `primary/5` tint over a `primary/10`
// hairline (as in the Skills Manager / ContentLayout headers), with the column
// names set in typo-caption so they read as labels, not fine print.
//
// Each column header is a toggle: pressing it filters the rows to the skills
// present in that column, pressing it again clears the filter. The corner cell
// is where the filter's state lives — "Skill · 24" at rest, a clearable chip
// naming the column while filtered — so the one place that says what the rows
// ARE is also the one place that says why there are fewer of them.
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { formatPercent } from '@/lib/utils/formatters';

import { FOCUS, HEAD_ROW, LABEL_COL, navId, tint } from './heatmapKit';
import { columnCoveragePct, type RegistryColumn, type RegistryModel } from './registryTypes';

const VERTICAL: React.CSSProperties = { writingMode: 'vertical-rl', transform: 'rotate(180deg)' };
/** The header wash: primary/5 laid over the opaque background as an image, so
 *  the sticky row (and its sticky corner) stay opaque over scrolled cells. */
const WASH = 'color-mix(in oklab, var(--primary) 5%, transparent)';
const HEAD_TINT: React.CSSProperties = { backgroundImage: `linear-gradient(${WASH}, ${WASH})` };

export function RegistryHeatmapHeader({ model, filterId, shownCount, onToggle, tabFor, chipTransition }: {
  model: RegistryModel;
  filterId: string | null;
  /** Rows the current filter leaves (the whole list when unfiltered). */
  shownCount: number;
  onToggle: (columnId: string | null) => void;
  /** `0` for the grid's single tab stop, `-1` for everything else. */
  tabFor: (id: string) => 0 | -1;
  chipTransition: object;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const { columns, skills, mode } = model;
  const filtered = columns.find((c) => c.id === filterId) ?? null;
  const clearId = navId(HEAD_ROW, LABEL_COL);

  return (
    <div role="row" className="sticky top-0 z-20 col-span-full grid grid-cols-subgrid border-b border-primary/10 bg-background" style={HEAD_TINT}>
      {/* Corner — its content is absolutely placed so the chip can never
          widen the label track and shove the whole cell field sideways. */}
      <div role="columnheader" className="sticky left-0 z-10 min-w-[11rem] border-r border-primary/10 bg-background" style={HEAD_TINT}>
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 px-3 pb-2">
          <AnimatePresence initial={false} mode="wait">
            {filtered ? (
              <motion.span
                key="chip"
                initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 4 }}
                transition={chipTransition}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-pill border border-primary/25 bg-primary/10 py-0.5 pl-2.5 pr-0.5"
                data-testid="registry-filter-chip"
              >
                <span className="typo-label truncate text-primary">{filtered.name}</span>
                <span className="typo-label tabular-nums text-foreground">{shownCount}</span>
                <button
                  type="button"
                  onClick={() => onToggle(null)}
                  aria-label={tx(d.skills_registry_filter_clear, { name: filtered.name })}
                  tabIndex={tabFor(clearId)}
                  data-nav={clearId} data-nav-r={0} data-nav-c={0}
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-pill text-foreground transition-colors hover:bg-primary/20 hover:text-primary ${FOCUS}`}
                  data-testid="registry-filter-clear"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </motion.span>
            ) : (
              <motion.span
                key="label"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={chipTransition}
                className="flex items-baseline gap-1.5"
              >
                <span className="typo-label text-foreground">{d.skills_sort_skill}</span>
                <span className="typo-label tabular-nums text-primary">{skills.length}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </div>

      {columns.map((c, j) => (
        <ColumnHeader
          key={c.id}
          column={c}
          dot={c.color ?? model.header?.color ?? 'var(--status-neutral)'}
          index={j}
          selected={c.id === filterId}
          hint={mode === 'project'
            ? tx(d.skills_registry_group_hint, { name: c.name, present: c.presentCount, total: skills.length, contexts: c.units })
            : tx(d.skills_registry_project_hint, { name: c.name, adopted: c.presentCount, total: skills.length, contexts: c.units })}
          coverageHint={
            columnCoveragePct(c) == null
              ? null
              : tx(d.skills_registry_context_coverage, {
                covered: c.coveredUnits ?? 0,
                contexts: c.units,
                pct: formatPercent(columnCoveragePct(c) ?? 0, { precision: 0 }),
              })
          }
          action={c.id === filterId ? d.skills_registry_filter_active_hint : d.skills_registry_filter_hint}
          tabIndex={tabFor(navId(HEAD_ROW, c.id))}
          onToggle={() => onToggle(c.id === filterId ? null : c.id)}
        />
      ))}
      <div aria-hidden />
    </div>
  );
}

function ColumnHeader({ column: c, dot, index, selected, hint, coverageHint, action, tabIndex, onToggle }: {
  column: RegistryColumn;
  /** The column's accent, falling back to the matrix's own colour. */
  dot: string;
  index: number;
  selected: boolean;
  hint: string;
  /** "n of m contexts touched (x%)" — null in project mode, which has no union. */
  coverageHint: string | null;
  action: string;
  tabIndex: 0 | -1;
  onToggle: () => void;
}) {
  const coverage = columnCoveragePct(c);
  return (
    <div role="columnheader" className="flex justify-center px-px pt-1.5">
      <Tooltip
        content={(
          <span className="flex flex-col gap-0.5">
            <span>{hint}</span>
            {coverageHint && <span>{coverageHint}</span>}
            <span className="typo-label text-primary">{action}</span>
          </span>
        )}
        placement="top"
      >
        <button
          type="button"
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={coverageHint ? `${hint}. ${coverageHint}. ${action}` : `${hint}. ${action}`}
          tabIndex={tabIndex}
          data-nav={navId(HEAD_ROW, c.id)} data-nav-r={0} data-nav-c={index + 1}
          data-testid={`registry-column-${c.id}`}
          className={`group/col relative flex h-[6.5rem] w-full flex-col items-center justify-end gap-1.5 rounded-t-interactive pb-2 transition-colors ${FOCUS} ${
            selected ? 'bg-primary/15' : 'hover:bg-primary/5'
          }`}
        >
          <span
            className={`typo-caption leading-none max-h-[4.75rem] min-h-0 overflow-hidden text-ellipsis whitespace-nowrap transition-colors ${
              selected ? 'text-primary' : 'text-foreground group-hover/col:text-primary'
            }`}
            style={VERTICAL}
          >
            {c.name}
          </span>
          <span className={`flex-shrink-0 rounded-full transition-all ${selected ? 'h-2 w-2' : 'h-1.5 w-1.5'}`} style={{ backgroundColor: dot }} aria-hidden />
          <span
            className="typo-label flex-shrink-0 rounded-pill px-1 tabular-nums text-foreground"
            style={{ backgroundColor: tint('var(--primary)', selected ? 0.22 : 0.08) }}
            aria-hidden
          >
            {c.presentCount}
          </span>
          {/* How much of THIS repo the fleet has actually touched. The cells
              below say how far one skill reached; this says how far anything
              did. Reads from `dev_tools_memory_coverage().covered`, which the
              matrix already fetched and used to discard. Hidden (not zeroed)
              where no union exists — see `columnCoveragePct`. */}
          {coverage != null && (
            <span
              className="typo-label flex-shrink-0 tabular-nums text-muted"
              data-testid={`registry-column-coverage-${c.id}`}
              aria-hidden
            >
              {formatPercent(coverage, { precision: 0 })}
            </span>
          )}
          {/* selected edge — the column's "tab" underline */}
          <span className={`absolute inset-x-1 bottom-0 h-0.5 rounded-pill bg-primary transition-opacity ${selected ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
