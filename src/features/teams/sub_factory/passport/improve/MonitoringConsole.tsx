// The Monitoring modal's body — "Console v2", the prototype winner (2026-08-06,
// rounds 1–5; the Pipeline / Rows / Focus / Ledger / Track variants and the
// separate Upgrade lane are gone).
//
// The old deploy popover's content is DISSOLVED into the chrome rather than
// kept as a second lane:
//
//   HEADER  the readings — current observability level as the wall's own
//           segmented-level strip (ladderFor + ordinalTint), and the matching
//           vault connectors as view-only marks with health dimming. Glanceable
//           facts live where the eye starts and never scroll.
//   GRID    2×2 capability cards. Each is split LEFT = codebase / RIGHT = vault,
//           both drawn as hero-size tool marks; the split collapses to one mark
//           when both sides name the same tool — the only visual state that
//           means "done". Each card also carries a FOCUSED SCAN dispatching a
//           Dev-runner session specialized to that one area.
//   FOOTER  the dimension-wide deployment actions in the dialog's commit row,
//           right-aligned. Project-specific on purpose — the fleet-wide "queue
//           for all N" stays in the wall popover (ImproveClassicPanel), not
//           here.
//
// One implementation throughout: readings via ladderFor, actions via the same
// `useImproveActions` the classic popover panel runs on.
import { useState } from 'react';
import { ScanSearch } from 'lucide-react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { ordinalTint } from '../passportModel';
import { ladderFor } from './levels';
import {
  CandidateList, CapabilityCard, CapabilityHead, CardAction, DeployNote, MergedTool, sameTool, SideHalf, ToolMark, UnbindButton,
} from './monitoringCard';
import type { MonitoringRow, MonitoringVariantProps } from './monitoringTypes';
import { useImproveActions } from './useImproveActions';

export function MonitoringConsole({
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

      {/* Commit row — right-aligned like every dialog's action edge. Only THIS
          project's runs; the fleet-wide batch lives in the wall popover. */}
      {ops && ops.actions.length > 0 && (
        <div className="flex items-center justify-end gap-3 px-4 py-2 border-t border-primary/10 bg-secondary/10 flex-shrink-0 min-w-0 overflow-x-auto">
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
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** One capability. Split body (code | vault) in hero-size tool marks; merged to
 *  a single mark when both sides agree; flips into the candidate list to bind. */
function ConsoleCard({ row, busy, deploying, onAssign, onDeploy, footerExtra }: {
  row: MonitoringRow;
  busy: boolean;
  deploying: boolean;
  onAssign: (credentialId: string | null) => void;
  onDeploy: () => void;
  /** Extra control beside the main action — the focused-scan button. */
  footerExtra?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const d = t.plugins.dev_tools;
  const [picking, setPicking] = useState(false);
  const merged = sameTool(row.detected, row.bound);

  return (
    <CapabilityCard icon={row.def.icon} testId={`monitoring-card-${row.def.key}`}>
      <CapabilityHead icon={row.def.icon} label={d[`monitoring_item_${row.def.labelKey}`]} state={row.state} />

      {picking ? (
        <CandidateList
          row={row}
          busy={busy}
          onAssign={(id) => { onAssign(id); setPicking(false); }}
          onCancel={() => setPicking(false)}
        />
      ) : (
        <>
          <div className="relative flex-1 min-h-0 flex items-stretch overflow-y-auto">
            {merged && row.bound ? (
              <MergedTool label={row.bound.name} serviceType={row.bound.serviceType}>
                <UnbindButton busy={busy} onClick={() => onAssign(null)} />
              </MergedTool>
            ) : (
              <>
                <SideHalf side="code" toolLabel={row.detected} />
                <span className="w-px my-2 bg-primary/10 shrink-0" aria-hidden />
                <SideHalf side="vault" toolLabel={row.bound?.name ?? null} serviceType={row.bound?.serviceType}>
                  {row.bound && <UnbindButton busy={busy} onClick={() => onAssign(null)} />}
                </SideHalf>
              </>
            )}
          </div>

          {row.state === 'not_implemented' && (
            <div className="relative px-3 pb-2"><DeployNote /></div>
          )}
          <div className="relative px-3 py-2 border-t border-primary/10 flex items-center gap-1.5">
            <span className="flex-1 min-w-0">
              <CardAction row={row} busy={busy} deploying={deploying} onPick={() => setPicking(true)} onDeploy={onDeploy} />
            </span>
            {footerExtra}
          </div>
        </>
      )}
    </CapabilityCard>
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
