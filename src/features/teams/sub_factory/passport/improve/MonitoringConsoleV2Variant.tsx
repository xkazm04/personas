// VARIANT B — "Console v2". Console's grid plus the Upgrade lane, folded in.
//
// A is two lanes: the capability tiles, and a tab holding the golden-standard
// actions in the old popover's markup. That tab is where the ladder, the "why
// this rating" line, the connector grid and the Queue / Deploy actions live —
// and putting them behind a tab means the answer to "what should I do about
// this dimension" is somewhere you have to go looking.
//
// v2 puts both on one screen: the four tiles on the left, an upgrade rail on
// the right, all in Console's own vocabulary — neutral cards, icon-led rows,
// sentence-case labels. Nothing is re-implemented: the rail runs on the SAME
// `useImproveActions` hook the classic panel does, so "queue for all N projects
// that need this" exists once.
import { useState } from 'react';
import { ChevronDown, ChevronRight, Rocket, ScanSearch } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';

import { LevelLadder } from './LevelLadder';
import { ConnectorSection } from './ConnectorSection';
import { ConsoleCard } from './MonitoringConsoleVariant';
import type { MonitoringVariantProps } from './monitoringTypes';
import { useImproveActions } from './useImproveActions';

export function MonitoringConsoleV2Variant({
  rows, busyKey, deploying, onAssign, onDeploy, slug, upgradeRow, onDone,
}: MonitoringVariantProps & {
  slug: string;
  /** The row whose actions/ladder describe this dimension (`observability`). */
  upgradeRow: string;
  onDone: () => void;
}) {
  return (
    <div className="flex-1 min-h-0 grid grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="min-h-0 grid grid-cols-2 grid-rows-2 gap-3 p-4 overflow-y-auto">
        {rows.map((row) => (
          <ConsoleCard
            key={row.def.key}
            row={row}
            busy={busyKey === row.def.key}
            deploying={deploying === row.def.key}
            onAssign={(id) => onAssign(row.def.key, id)}
            onDeploy={() => onDeploy(row)}
          />
        ))}
      </div>

      <div className="min-h-0 overflow-y-auto border-l border-primary/10 p-4">
        <UpgradeRail slug={slug} rowKey={upgradeRow} onDone={onDone} />
      </div>
    </div>
  );
}

/** The Upgrade lane in Console's language. Same operations, same order as the
 *  classic panel — provenance, ladder, connector grid, actions. */
function UpgradeRail({ slug, rowKey, onDone }: { slug: string; rowKey: string; onDone: () => void }) {
  const { t, tx } = useTranslation();
  const d = t.plugins.dev_tools;
  const ops = useImproveActions(slug, rowKey, onDone);
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!ops) return null;

  return (
    <div className="space-y-3">
      <p className="typo-body font-semibold text-foreground">{d.monitoring_lane_upgrade}</p>

      {ops.reason && (
        <p className="typo-caption text-foreground/60 leading-snug" style={{ fontWeight: 400 }}>{ops.reason}</p>
      )}

      {ops.hasLadder && <LevelLadder rowKey={rowKey} passport={ops.passport} />}
      {ops.showConnector && <ConnectorSection slug={slug} rowKey={rowKey} onClose={onDone} />}

      {ops.actions.length === 0 && !ops.hasLadder && !ops.showConnector && (
        <p className="typo-caption text-foreground/45" style={{ fontWeight: 400 }}>{d.monitoring_upgrade_none}</p>
      )}

      {ops.actions.map((a) => {
        const Icon = a.kind === 'scan' ? ScanSearch : Rocket;
        const open = expanded === a.id;
        return (
          <section key={a.id} className="rounded-card border border-primary/12 bg-secondary/[0.15] overflow-hidden">
            <div className="flex items-start gap-2 px-3 py-2.5">
              <Icon className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" aria-hidden />
              <div className="min-w-0">
                <p className="typo-body font-semibold text-foreground">{a.label}</p>
                <p className="typo-caption text-foreground/60 leading-snug mt-0.5" style={{ fontWeight: 400 }}>{a.hint}</p>
              </div>
            </div>

            {a.kind === 'task' && (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded((e) => (e === a.id ? null : a.id))}
                  className="mx-3 mb-1 inline-flex items-center gap-1 typo-caption text-foreground/45 hover:text-foreground transition-colors"
                  style={{ fontWeight: 400 }}
                >
                  {open ? <ChevronDown className="w-3 h-3" aria-hidden /> : <ChevronRight className="w-3 h-3" aria-hidden />}
                  {open ? d.monitoring_hide_prompt : d.monitoring_view_prompt}
                </button>
                {open && (
                  <pre className="mx-3 mb-2 max-h-44 overflow-y-auto rounded-input bg-background/60 border border-primary/10 p-2 typo-code text-foreground/75 whitespace-pre-wrap">{ops.promptFor(a)}</pre>
                )}
              </>
            )}

            <div className="flex items-center gap-1.5 px-3 py-2 border-t border-primary/10">
              {a.kind === 'scan' ? (
                ops.hasContextMap ? (
                  <>
                    <RailButton onClick={() => void ops.run(a, 'scan', true)} busy={ops.busy === a.id} label={d.monitoring_rescan_incremental} />
                    <RailButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label={d.monitoring_rescan_full} />
                  </>
                ) : (
                  <RailButton primary onClick={() => void ops.run(a, 'scan', false)} busy={ops.busy === a.id} label={d.monitoring_run_scan} />
                )
              ) : (
                <>
                  <RailButton onClick={() => void ops.run(a, 'queue')} busy={ops.busy === a.id} label={d.monitoring_queue_task} />
                  <RailButton primary onClick={() => void ops.run(a, 'deploy')} busy={ops.busy === a.id} label={d.monitoring_deploy_now} />
                </>
              )}
            </div>

            {a.kind === 'task' && ops.batchSize(a) > 1 && (
              <button
                type="button"
                onClick={() => void ops.runBatch(a)}
                disabled={ops.busy === a.id}
                className="w-full text-left px-3 py-1.5 border-t border-primary/10 typo-caption text-primary hover:bg-primary/[0.06] transition-colors disabled:opacity-50"
                style={{ fontWeight: 400 }}
              >
                {tx(d.monitoring_queue_all, { count: ops.batchSize(a) })}
              </button>
            )}
          </section>
        );
      })}
    </div>
  );
}

function RailButton({ label, onClick, busy, primary }: { label: string; onClick: () => void; busy: boolean; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex-1 px-2 py-1 rounded-interactive typo-caption font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        primary
          ? 'text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25'
          : 'text-foreground hover:bg-secondary/40 border border-primary/10'
      }`}
    >
      {busy ? '…' : label}
    </button>
  );
}
