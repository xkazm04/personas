// R16 — the passport HEADER CARD redesign (/prototype, two variants).
//
// The original cover spent its space representing automation depth (full-width
// axis bars, golden line) — that metadata already lives in the wall's column
// rows. The header instead becomes the PROJECT'S OVERALL REPRESENTATION in the
// limited space it has:
//   Name · Production readiness + Automation level as ICON+VALUE tokens (no
//   bars) · Trend as arrow+number · a 5-slot STACK STRIP (framework /
//   persistence / hosting / auth / monitoring — grayed default glyphs when a
//   slot isn't wired) · contexts count · passed/total KPIs.
//
// Variants (different visual structures, same metadata):
//   • Tokens   — three compact lines: title+trend, inline stat tokens, stack strip.
//   • Statband — title+stack up top, then a labeled mini-scoreboard band
//     (value over 9px uppercase label, five cells).
import type { LucideIcon } from 'lucide-react';
import { Activity, Boxes, Database, KeyRound, Server } from 'lucide-react';

import { resolveTechIcon } from '@/features/teams/sub_factory/passport/techIcons';
import {
  AUTOMATION_LABEL, PROD_BAND_LABEL, type AppPassport, type ProdBand,
} from '@/features/teams/sub_factory/passport/passportModel';

import { NEON, SETUP_BLUE, scoreInk } from './cockpitGlyphs';
import { HEADER_STATS, wallHealth, type WallEntry, type WallHeaderStats } from './wallMock';

const BAND_CODE: Record<ProdBand, string> = {
  prototype: 'PT', internal: 'IN', beta: 'BE', production: 'PR', hardened: 'HD',
};

// -- the 5-slot stack strip ------------------------------------------------------

interface StackSlot {
  key: string;
  category: string;
  label: string | null;
  fallback: LucideIcon;
}

function stackSlots(p: AppPassport): StackSlot[] {
  return [
    { key: 'framework', category: 'Framework', label: p.stack.frameworks[0] ?? null, fallback: Boxes },
    { key: 'persistence', category: 'Persistence', label: p.stack.persistence[0]?.engine ?? null, fallback: Database },
    { key: 'hosting', category: 'Hosting', label: p.stack.hosting ?? null, fallback: Server },
    { key: 'auth', category: 'Auth', label: p.stack.auth ?? null, fallback: KeyRound },
    { key: 'monitoring', category: 'Monitoring', label: p.stack.monitoring.errorTracking, fallback: Activity },
  ];
}

export function StackStrip({ p, size = 14 }: { p: AppPassport; size?: number }) {
  return (
    <span className="inline-flex items-center gap-2" data-testid="stack-strip">
      {stackSlots(p).map((slot) => {
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
          // Wired, but no brand glyph — the default icon in live ink.
          return (
            <span key={slot.key} title={`${slot.category}: ${slot.label}`} className="inline-flex shrink-0 text-foreground/75">
              <Fallback style={{ width: size, height: size }} aria-hidden />
            </span>
          );
        }
        // Not wired — the grayed default glyph.
        return (
          <span key={slot.key} title={`${slot.category} — not wired`} className="inline-flex shrink-0 text-foreground/20" data-testid={`stack-unwired-${slot.key}`}>
            <Fallback style={{ width: size, height: size }} aria-hidden />
          </span>
        );
      })}
    </span>
  );
}

// -- shared value atoms ------------------------------------------------------------

function Trend({ trend }: { trend: number }) {
  if (trend === 0) return <span className="text-[10.5px] tabular-nums text-foreground/30">—</span>;
  const up = trend > 0;
  return (
    <span
      className="inline-flex items-center gap-0.5 text-[10.5px] tabular-nums font-semibold"
      style={{ color: up ? NEON.emerald : NEON.red }}
      title={`Golden-standard trend: ${up ? '+' : ''}${trend} since last change`}
    >
      {up ? '▲' : '▼'}{Math.abs(trend)}
    </span>
  );
}

function kpiHue(s: WallHeaderStats): string {
  if (s.kpiTotal === 0) return 'rgba(148,163,184,.35)';
  if (s.kpiPassed === s.kpiTotal) return NEON.emerald;
  return s.kpiPassed / s.kpiTotal >= 0.5 ? NEON.amber : NEON.red;
}

function worstHue(entry: WallEntry): string {
  const h = wallHealth(entry.project);
  if (h.crit > 0) return NEON.red;
  if (h.warn > 0) return NEON.amber;
  if (h.total === 0) return SETUP_BLUE;
  return NEON.emerald;
}

// -- the winning header (R16 verdict: Statband) ------------------------------------------------------------

export function HeaderStatband({ entry, onOpen }: { entry: WallEntry; onOpen: (id: string) => void }) {
  const { project, passport } = entry;
  const stats = HEADER_STATS[project.id] ?? { kpiPassed: 0, kpiTotal: 0, trend: 0 };
  const health = wallHealth(entry.project);
  const worst = worstHue(entry);

  const cell = (value: React.ReactNode, label: string, title: string) => (
    <span className="flex flex-col items-center gap-0.5 min-w-0" title={title}>
      <span className="text-[11.5px] font-semibold tabular-nums leading-none">{value}</span>
      <span className="text-[8.5px] uppercase tracking-[0.14em] text-foreground/35 leading-none">{label}</span>
    </span>
  );

  return (
    <div data-testid={`header-statband-${project.id}`}>
      {/* identity + stack on one line */}
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: worst, boxShadow: `0 0 6px ${worst}88` }} />
        <button type="button" onClick={() => onOpen(project.id)} title={project.purpose} className="group/hd inline-flex min-w-0 text-left">
          <span className="typo-body font-semibold tracking-tight text-foreground truncate group-hover/hd:text-primary transition-colors">{project.name}</span>
        </button>
        <span className="ml-auto shrink-0"><StackStrip p={passport} size={13} /></span>
      </div>
      {/* the labeled scoreboard band */}
      <div
        className="mt-2.5 flex items-center justify-between rounded-card px-2.5 py-1.5"
        style={{ background: 'rgba(148,163,184,.05)', border: '1px solid rgba(148,163,184,.10)' }}
      >
        {cell(
          <span style={{ color: scoreInk(passport.automationReadiness.score) }}>{passport.automationReadiness.level}</span>,
          'Auto',
          `Automation: ${AUTOMATION_LABEL[passport.automationReadiness.level]} — ${passport.automationReadiness.score}/100`,
        )}
        {cell(
          <span style={{ color: scoreInk(passport.productionReadiness.score) }}>{BAND_CODE[passport.productionReadiness.band]}</span>,
          'Prod',
          `Production: ${PROD_BAND_LABEL[passport.productionReadiness.band]} — ${passport.productionReadiness.score}/100`,
        )}
        {cell(<Trend trend={stats.trend} />, 'Trend', 'Golden-standard trend since last change')}
        {cell(
          <span style={{ color: health.total === 0 ? SETUP_BLUE : 'rgba(226,232,240,.9)' }}>{health.total}</span>,
          'Ctx',
          `${health.total} contexts mapped`,
        )}
        {cell(
          <span style={{ color: kpiHue(stats) }}>{stats.kpiPassed}/{stats.kpiTotal}</span>,
          'KPI',
          `${stats.kpiPassed} of ${stats.kpiTotal} KPIs passing`,
        )}
      </div>
    </div>
  );
}
