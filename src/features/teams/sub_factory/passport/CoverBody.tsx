// R18 — the Statband cover (bench R16/R17 winner, real data): identity +
// action icons + the 5-slot stack strip on one line, then the labeled
// mini-scoreboard band (Auto / Prod / Trend / Ctx / KPI). The axis depth the
// old cover carried lives in the Compare rows; production affordances
// (warning badge, standards scan, markdown export) stay on the title row.
// Exported (via ProjectsPassportWall) for reuse as the Mastermind project
// sidebar's header.
import { useState } from 'react';
import { Activity, ArrowUpRight, Boxes, Compass, Database, FileDown, KeyRound, Server, TerminalSquare } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { listCredentials } from '@/api/vault/credentials';
import { CopyButton } from '@/features/shared/components/buttons/CopyButton';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { toastCatch } from '@/lib/silentCatch';
import { passportToMarkdown } from './passportExport';
import { AUTOMATION_LABEL, PROD_BAND_LABEL, type AppPassport } from './passportModel';
import { INK, scoreInk } from './passportInk';
import { trendDelta } from './passportHistory';
import { resolveTechIcon } from './techIcons';
import { useImprove } from './improve/ImproveContext';
import { buildOnboardPrompt, onboardDispatchKey } from './onboardDispatch';
import { dispatchRowToFleet, PASSPORT_FLEET_INK } from './passportFleet';
import { StandardsScan } from './improve/StandardsScan';
import { WarningBadge, type WarningItem } from './WarningBadge';

const BAND_CODE: Record<string, string> = {
  prototype: 'PT', internal: 'IN', beta: 'BE', production: 'PR', hardened: 'HD',
};

export interface HeaderStatsShape { contexts: number; kpiPassed: number; kpiTotal: number }

export interface CoverBodyProps {
  p: AppPassport;
  openable: boolean;
  onOpen?: (slug: string) => void;
  attention: WarningItem[];
  onJumpKpi?: (projectId: string, groupId: string, kpiId: string) => void;
  stats: HeaderStatsShape | null;
  /** Real app favicon (data URL); null → the worst-state dot stays. */
  favicon?: string | null;
  /** Guided-onboarding door (wall only; absent on the Mastermind sidebar):
   *  the live `passport:onboard:<slug>` session if one runs, and the terminal
   *  opener. Dispatch itself happens here via ImproveContext + Fleet. */
  onboard?: { session: FleetSession | null; onOpenTerminal: () => void };
}

const ONBOARD_COPY = {
  idle: 'Onboard with Fleet — guided passport onboarding in this repo',
  active: 'Onboarding session live — open terminal',
  noRaw: 'passport onboard dispatch',
};

function OnboardDoor({ p, onboard }: { p: AppPassport; onboard: NonNullable<CoverBodyProps['onboard']> }) {
  const improve = useImprove();
  const [busy, setBusy] = useState(false);
  const s = onboard.session;

  if (s) {
    const ink = PASSPORT_FLEET_INK[String(s.state)] ?? 'rgba(148,163,184,.5)';
    return (
      <button
        type="button"
        onClick={onboard.onOpenTerminal}
        title={ONBOARD_COPY.active}
        className="flex-shrink-0 p-0.5 transition-colors focus-ring"
        style={{ color: ink }}
        data-testid={`passport-onboard-live-${p.identity.slug}`}
      >
        <TerminalSquare className="w-3.5 h-3.5" aria-hidden />
      </button>
    );
  }

  const raw = improve?.getRaw(p.identity.slug);
  if (!raw) return null;

  const dispatch = () => {
    if (busy) return;
    setBusy(true);
    listCredentials()
      .then((creds) => dispatchRowToFleet(
        onboardDispatchKey(p.identity.slug),
        raw.project.root_path,
        buildOnboardPrompt(p, raw, creds),
      ))
      // R20 doctrine: no auto-open — the tinted icon appears via the 5s poll.
      .then(() => setBusy(false))
      .catch((e) => { setBusy(false); toastCatch(ONBOARD_COPY.noRaw)(e); });
  };

  return (
    <button
      type="button"
      onClick={dispatch}
      disabled={busy}
      title={ONBOARD_COPY.idle}
      className="flex-shrink-0 p-0.5 text-foreground/45 hover:text-primary disabled:opacity-40 transition-colors focus-ring"
      data-testid={`passport-onboard-${p.identity.slug}`}
    >
      <Compass className="w-3.5 h-3.5" aria-hidden />
    </button>
  );
}

function StackStrip({ p, size = 13 }: { p: AppPassport; size?: number }) {
  const slots: Array<{ key: string; category: string; label: string | null; fallback: LucideIcon }> = [
    { key: 'framework', category: 'Framework', label: p.stack.frameworks[0] ?? null, fallback: Boxes },
    { key: 'persistence', category: 'Persistence', label: p.stack.persistence[0]?.engine ?? null, fallback: Database },
    { key: 'hosting', category: 'Hosting', label: p.stack.hosting ?? null, fallback: Server },
    { key: 'auth', category: 'Auth', label: p.stack.auth ?? null, fallback: KeyRound },
    { key: 'monitoring', category: 'Monitoring', label: p.stack.monitoring.errorTracking, fallback: Activity },
  ];
  return (
    <span className="inline-flex items-center gap-1.5" data-testid="passport-stack-strip">
      {slots.map((slot) => {
        const match = slot.label ? resolveTechIcon(slot.label) : null;
        const Fallback = slot.fallback;
        if (match) {
          return (
            <span key={slot.key} title={`${slot.category}: ${slot.label}`} className="inline-flex shrink-0">
              <svg width={size} height={size} viewBox="0 0 24 24" fill={match.icon.color ?? 'currentColor'} aria-hidden>
                <path d={match.icon.path} />
              </svg>
            </span>
          );
        }
        if (slot.label) {
          return (
            <span key={slot.key} title={`${slot.category}: ${slot.label}`} className="inline-flex shrink-0 text-foreground/75">
              <Fallback style={{ width: size, height: size }} aria-hidden />
            </span>
          );
        }
        return (
          <span key={slot.key} title={`${slot.category} — not wired`} className="inline-flex shrink-0 text-foreground/20" data-testid={`passport-unwired-${slot.key}`}>
            <Fallback style={{ width: size, height: size }} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

export function CoverBody({
  p, openable, onOpen, attention, onJumpKpi, stats, favicon = null, onboard,
}: CoverBodyProps) {
  const worst = scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score));
  const trend = trendDelta(p.identity.slug)?.golden ?? 0;
  const kpiHue =
    !stats || stats.kpiTotal === 0 ? 'rgba(148,163,184,.35)'
    : stats.kpiPassed === stats.kpiTotal ? INK.emerald
    : stats.kpiPassed / stats.kpiTotal >= 0.5 ? INK.amber : INK.red;

  const cell = (value: React.ReactNode, label: string, title: string) => (
    <span className="flex flex-col items-center gap-0.5 min-w-0" title={title}>
      <span className="text-[11.5px] font-semibold tabular-nums leading-none">{value}</span>
      <span className="text-[8.5px] uppercase tracking-[0.14em] text-foreground/35 leading-none">{label}</span>
    </span>
  );

  return (
    <>
      {/* identity + production affordances + stack strip */}
      <div className="flex items-center gap-1.5 min-w-0">
        {favicon ? (
          <img src={favicon} alt="" className="w-4 h-4 rounded-[3px] shrink-0" data-testid="cover-favicon" aria-hidden />
        ) : (
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} aria-hidden />
        )}
        {openable ? (
          <button type="button" onClick={() => onOpen!(p.identity.slug)} title={p.identity.purpose} className="group/cov inline-flex items-center gap-1 min-w-0 text-left">
            <span className="typo-body font-semibold tracking-tight truncate group-hover/cov:text-primary transition-colors">{p.identity.name}</span>
            <ArrowUpRight className="w-3.5 h-3.5 flex-shrink-0 opacity-0 group-hover/cov:opacity-100 text-primary/70 transition-opacity" aria-hidden />
          </button>
        ) : (
          <span title={p.identity.purpose} className="typo-body font-semibold tracking-tight truncate block">{p.identity.name}</span>
        )}
        <WarningBadge projectName={p.identity.name} items={attention} onJump={(g, k) => onJumpKpi?.(p.identity.slug, g, k)} />
        {onboard && <OnboardDoor p={p} onboard={onboard} />}
        <StandardsScan slug={p.identity.slug} projectName={p.identity.name} />
        <CopyButton
          text={passportToMarkdown(p, Date.now())}
          icon={<FileDown className="w-3.5 h-3.5" />}
          tooltip="Copy readiness report (markdown)"
          className="flex-shrink-0 p-0.5 text-foreground/45 hover:text-primary"
        />
        <span className="ml-auto shrink-0"><StackStrip p={p} /></span>
      </div>

      {/* the labeled scoreboard band */}
      <div
        className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
        style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
        data-testid={`passport-statband-${p.identity.slug}`}
      >
        {cell(
          <span style={{ color: scoreInk(p.automationReadiness.score) }}>{p.automationReadiness.level}</span>,
          'Auto',
          `Automation: ${AUTOMATION_LABEL[p.automationReadiness.level]} — ${p.automationReadiness.score}/100`,
        )}
        {cell(
          <span style={{ color: scoreInk(p.productionReadiness.score) }}>{BAND_CODE[p.productionReadiness.band]}</span>,
          'Prod',
          `Production: ${PROD_BAND_LABEL[p.productionReadiness.band]} — ${p.productionReadiness.score}/100`,
        )}
        {cell(
          trend === 0
            ? <span className="text-foreground/30">—</span>
            : <span style={{ color: trend > 0 ? INK.emerald : INK.red }}>{trend > 0 ? '▲' : '▼'}{Math.abs(trend)}</span>,
          'Trend',
          'Golden-standard trend since last recorded change',
        )}
        {cell(
          <span style={{ color: !stats || stats.contexts === 0 ? INK.blue : 'rgba(226,232,240,.9)' }}>{stats?.contexts ?? 0}</span>,
          'Ctx',
          `${stats?.contexts ?? 0} contexts mapped`,
        )}
        {cell(
          <span style={{ color: kpiHue }}>{stats ? `${stats.kpiPassed}/${stats.kpiTotal}` : '0/0'}</span>,
          'KPI',
          `${stats?.kpiPassed ?? 0} of ${stats?.kpiTotal ?? 0} KPIs meeting target`,
        )}
      </div>
    </>
  );
}
