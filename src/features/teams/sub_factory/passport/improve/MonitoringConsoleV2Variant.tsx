// VARIANT B — "Console v2". The Upgrade lane DISSOLVED into the modal chrome
// instead of pasted beside it.
//
// The first v2 put the classic panel next to the grid almost 1:1 — a rail of
// the popover's boxes wearing new CSS. This one breaks the lane into the parts
// it was made of and gives each the place it belongs:
//
//   HEADER  the readings — current observability level as a mini segmented bar
//           (the wall's own level grammar), and the matching vault connectors
//           as view-only marks. Facts you glance at, so they live where the eye
//           starts and never scroll.
//   GRID    the same four capability cards as Console, plus one new control:
//           a FOCUSED SCAN per card. The whole-dimension deploy asks one
//           session to fix observability at large; these specialize — one
//           session owns logs & tracing, another metrics — so each stays on its
//           area instead of grazing the union of all four.
//   FOOTER  the dimension-wide deployment actions — Queue / Deploy now /
//           "queue for all N projects" — where a dialog keeps its commit row.
//
// Nothing is re-implemented: readings come from `ladderFor` + the rows' own
// candidates, actions run through the same `useImproveActions` the classic
// panel uses, so "queue for all N" still exists exactly once.
import { ScanSearch } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { ordinalTint } from '../passportModel';
import { ladderFor } from './levels';
import { ConsoleCard } from './MonitoringConsoleVariant';
import { ToolMark } from './monitoringCard';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';
import { useImproveActions } from './useImproveActions';

export function MonitoringConsoleV2Variant({
  rows, busyKey, deploying, onAssign, onDeploy, slug, upgradeRow, onDone, areaScanning, onAreaScan,
}: MonitoringVariantProps & {
  slug: string;
  /** The row whose actions/ladder describe this dimension (`observability`). */
  upgradeRow: string;
  onDone: () => void;
  /** Card key whose focused scan is in flight. */
  areaScanning: string | null;
  onAreaScan: (row: MonitoringRow) => void;
}) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const ops = useImproveActions(slug, upgradeRow, onDone);
  const ladder = ops ? ladderFor(upgradeRow, ops.passport) : null;

  // Every vault credential any capability could use, deduped — the header's
  // view-only "what do I have to work with" strip. Binding stays on the cards.
  const seen = new Set<string>();
  const available = rows.flatMap((r) => r.candidates).filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  const health = rows[0]?.health ?? {};

  return (
    <>
      {(ladder || available.length > 0) && (
        <div className="flex items-center gap-5 px-4 py-2 border-b border-primary/10 flex-shrink-0 min-w-0">
          {ladder && <LevelStrip ladder={ladder} />}
          {available.length > 0 && (
            <div className="flex items-center gap-2 min-w-0 ml-auto">
              <span className="typo-caption text-foreground/45 shrink-0" style={{ fontWeight: 400 }}>{d.monitoring_vault_available}</span>
              <span className="flex items-center gap-1.5 min-w-0 overflow-hidden">
                {available.map((c) => (
                  <Tooltip key={c.id} content={`${c.name}${health[c.id] === false ? ` · ${d.envslot_unhealthy}` : ''}`} placement="bottom">
                    <span className={health[c.id] === false ? 'opacity-40' : undefined}>
                      <ToolMark label={c.name} serviceType={c.serviceType} size={20} />
                    </span>
                  </Tooltip>
                ))}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4 overflow-y-auto">
        {rows.map((row) => (
          <ConsoleCard
            key={row.def.key}
            row={row}
            busy={busyKey === row.def.key}
            deploying={deploying === row.def.key}
            onAssign={(id) => onAssign(row.def.key, id)}
            onDeploy={() => onDeploy(row)}
            footerExtra={(
              <Tooltip content={tx(d.monitoring_area_scan_hint, { area: d[`monitoring_item_${row.def.labelKey}`] })} placement="top">
                <button
                  type="button"
                  disabled={areaScanning === row.def.key}
                  onClick={() => onAreaScan(row)}
                  aria-label={tx(d.monitoring_area_scan_hint, { area: d[`monitoring_item_${row.def.labelKey}`] })}
                  className={`p-1 rounded-interactive text-primary/70 hover:text-primary hover:bg-primary/10 border border-primary/15 transition-colors disabled:opacity-40 shrink-0 ${areaScanning === row.def.key ? 'animate-pulse' : ''}`}
                >
                  <ScanSearch className="w-3.5 h-3.5" aria-hidden />
                </button>
              </Tooltip>
            )}
          />
        ))}
      </div>

      {ops && ops.actions.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0 min-w-0 overflow-x-auto">
          {ops.actions.map((a) => (
            <div key={a.id} className="flex items-center gap-1.5 min-w-0 shrink-0">
              <Tooltip content={a.hint} placement="top">
                <span className="typo-caption text-foreground/60 truncate max-w-[220px]" style={{ fontWeight: 400 }}>{a.label}</span>
              </Tooltip>
              {a.kind === 'scan' ? (
                ops.hasContextMap ? (
                  <>
                    <FooterButton onClick={() => void ops.run(a, 'scan', true)} busy={ops.busy === a.id} label={d.monitoring_rescan_incremental} />
                    <FooterButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label={d.monitoring_rescan_full} />
                  </>
                ) : (
                  <FooterButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label={d.monitoring_run_scan} />
                )
              ) : (
                <>
                  <FooterButton onClick={() => void ops.run(a, 'queue')} busy={ops.busy === a.id} label={d.monitoring_queue_task} />
                  <FooterButton primary onClick={() => void ops.run(a, 'deploy')} busy={ops.busy === a.id} label={d.monitoring_deploy_now} />
                  {ops.batchSize(a) > 1 && (
                    <button
                      type="button"
                      onClick={() => void ops.runBatch(a)}
                      disabled={ops.busy === a.id}
                      className="typo-caption text-primary hover:underline disabled:opacity-50 shrink-0"
                      style={{ fontWeight: 400 }}
                    >
                      {tx(d.monitoring_queue_all, { count: ops.batchSize(a) })}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The current level as the wall's own grammar: a segmented bar, each rung a
 *  segment, the reached ones tinted, the current rung named beside it. */
function LevelStrip({ ladder }: { ladder: NonNullable<ReturnType<typeof ladderFor>> }) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const pos = ladder.steps.length > 1 ? ladder.currentIndex / (ladder.steps.length - 1) : 0;
  const tint = ordinalTint(pos);
  return (
    <div className="flex items-center gap-2 min-w-0 shrink-0">
      <span className="typo-caption text-foreground/45 shrink-0" style={{ fontWeight: 400 }}>{d.monitoring_current_level}</span>
      <span className="flex items-center gap-0.5" aria-hidden>
        {ladder.steps.map((step, i) => (
          <span
            key={step}
            title={step}
            className="h-1.5 w-4 rounded-full"
            style={{ background: i <= ladder.currentIndex ? tint.hex : 'color-mix(in srgb, var(--foreground) 12%, transparent)' }}
          />
        ))}
      </span>
      <span className={`typo-caption font-semibold ${tint.text} shrink-0`}>{ladder.steps[ladder.currentIndex]}</span>
    </div>
  );
}

function FooterButton({ label, onClick, busy, primary }: { label: string; onClick: () => void; busy: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`px-2 py-1 rounded-interactive typo-caption font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0 ${
        primary
          ? 'text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25'
          : 'text-foreground hover:bg-secondary/40 border border-primary/10'
      }`}
    >
      {busy ? '…' : label}
    </button>
  );
}
