// Shared leaves for the Project Cockpit prototype variants (R1 — see
// docs/plans/dev-tools-cx-redesign.md §3). Hoisted from day one so both variants
// render identical semantics and the A/B compares layout, not behaviour.
//
// PROTOTYPE: mock data only, English copy (i18n at consolidation, per the
// established /prototype convention in this repo).
import type { ReactNode } from 'react';
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CheckCircle2, Database,
  GitBranch, KeyRound, Minus, Radar, Send, Shield, Sparkles, Star, Wrench,
} from 'lucide-react';

import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
// Real components from the shipped findings loop — the prototype should look like
// the product it will become, not a parallel invention.
import { VerdictChip, originMeta } from '../sub_triage/findings/FindingBadge';
import { kpiTone, type MockFinding, type MockKpi, type MockProject, type MockWiring, type WiringKey } from './cockpitMock';

export { VerdictChip, originMeta };

// -- tones ---------------------------------------------------------------------

const TONE_TEXT: Record<string, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  neutral: 'text-foreground/40',
};

const WIRING_ICON: Record<WiringKey, typeof GitBranch> = {
  repo: GitBranch,
  monitoring: Shield,
  llm: Radar,
  database: Database,
  auth: KeyRound,
};

// -- KPI value ------------------------------------------------------------------

/** The measurable state: `current → target`, tone-tinted, trend arrow. The single
 *  most repeated element in the cockpit — must stay compact and scannable. */
export function KpiValue({ kpi, size = 'md' }: { kpi: MockKpi; size?: 'md' | 'lg' }) {
  const tone = kpiTone(kpi);
  const num = size === 'lg' ? 'typo-data-lg' : 'typo-body font-semibold tabular-nums';
  if (kpi.current === null) {
    return <span className={`${num} text-foreground/30`}>—</span>;
  }
  return (
    <span className="inline-flex items-baseline gap-1.5 min-w-0">
      <span className={`${num} ${TONE_TEXT[tone]}`}>
        {kpi.unit === '$' && '$'}
        <Numeric value={kpi.current} precision={Number.isInteger(kpi.current) ? 0 : 1} />
        {kpi.unit !== '$' && kpi.unit}
      </span>
      <span className="typo-label text-foreground/40 tabular-nums shrink-0">
        / {kpi.unit === '$' && '$'}{kpi.target}{kpi.unit !== '$' ? kpi.unit : ''}
      </span>
      <TrendArrow kpi={kpi} />
    </span>
  );
}

function TrendArrow({ kpi }: { kpi: MockKpi }) {
  if (kpi.trendPct === null || kpi.trendPct === 0) {
    return kpi.trendPct === 0 ? <Minus className="w-3 h-3 text-foreground/30" aria-hidden /> : null;
  }
  // "Up" is only good when the KPI wants up.
  const rising = kpi.trendPct > 0;
  const good = kpi.direction === 'up' ? rising : !rising;
  const Icon = rising ? ArrowUpRight : ArrowDownRight;
  return (
    <Tooltip content={`${rising ? '+' : ''}${kpi.trendPct}% over the window`}>
      <span className={`inline-flex items-center gap-0.5 typo-label tabular-nums ${good ? 'text-status-success' : 'text-status-error'}`}>
        <Icon className="w-3 h-3" aria-hidden />
        {Math.abs(kpi.trendPct)}%
      </span>
    </Tooltip>
  );
}

// -- rating ----------------------------------------------------------------------

export function RatingStars({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <Tooltip content={`User rating ${value}/5`}>
      <span className="inline-flex items-center gap-0.5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={`w-3 h-3 ${i < Math.round(value) ? 'text-amber-400 fill-amber-400/80' : 'text-foreground/15'}`}
            aria-hidden
          />
        ))}
        <span className="typo-label text-foreground/50 tabular-nums ml-0.5">{value.toFixed(1)}</span>
      </span>
    </Tooltip>
  );
}

// -- wiring ----------------------------------------------------------------------

/** MEASUREMENT BEFORE OPINION: an unmeasured slot never fakes a number — it sells
 *  the wiring that would light it up. */
export function WiringCta({ wiringKey, compact = false }: { wiringKey: WiringKey; compact?: boolean }) {
  const Icon = WIRING_ICON[wiringKey];
  const label = wiringKey === 'llm' ? 'Wire LLM tracking' : wiringKey === 'monitoring' ? 'Wire monitoring' : `Wire ${wiringKey}`;
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-1.5 rounded-pill border border-dashed border-amber-400/40 bg-amber-500/5 text-amber-300/90 hover:bg-amber-500/15 hover:border-amber-400/70 transition-colors focus-ring ${
        compact ? 'px-2 py-0.5 typo-label' : 'px-2.5 py-1 typo-caption'
      }`}
      title="Connect the sensor in Vault → Connectors to measure this"
    >
      <Icon className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} aria-hidden />
      {label} →
    </button>
  );
}

/** One passport stamp on the cockpit header: earned (wired) or a gap (the CTA). */
export function WiringStamp({ wiring }: { wiring: MockWiring }) {
  const Icon = WIRING_ICON[wiring.key];
  if (wiring.wired) {
    return (
      <Tooltip content={`${wiring.label} — wired · ${wiring.unlocks}`}>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border border-emerald-500/25 bg-emerald-500/10 text-emerald-300 typo-label">
          <Icon className="w-3 h-3" aria-hidden />
          {wiring.label}
          <CheckCircle2 className="w-3 h-3" aria-hidden />
        </span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={`Not wired — unlocks: ${wiring.unlocks}`}>
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border border-dashed border-amber-400/35 bg-amber-500/5 text-amber-300/80 typo-label cursor-pointer hover:bg-amber-500/15 transition-colors">
        <Icon className="w-3 h-3" aria-hidden />
        {wiring.label}
      </span>
    </Tooltip>
  );
}

// -- dispatch --------------------------------------------------------------------

/** R1 stub — R3 designs the evidence card + channel picker this opens. */
export function DispatchStub({ subtle = false }: { subtle?: boolean }) {
  return (
    <Tooltip content="Dispatch — R3 prototypes the evidence card + channel picker (Runner · Fleet · Team · Studio)">
      <button
        type="button"
        className={`inline-flex items-center gap-1 rounded-interactive border transition-colors focus-ring px-2 py-0.5 typo-label ${
          subtle
            ? 'border-primary/10 text-foreground/40 hover:text-primary hover:border-primary/30 hover:bg-primary/5'
            : 'border-primary/20 bg-primary/5 text-foreground/70 hover:text-primary hover:bg-primary/10'
        }`}
      >
        <Send className="w-3 h-3" aria-hidden />
        Dispatch
      </button>
    </Tooltip>
  );
}

// -- findings --------------------------------------------------------------------

/** One finding with its receipt: origin badge → title → evidence → verdict. */
export function FindingLine({ finding, indent = false }: { finding: MockFinding; indent?: boolean }) {
  const meta = originMeta(finding.origin);
  const Icon = meta?.icon;
  return (
    <div className={`flex items-center gap-2 min-w-0 py-1 ${indent ? 'pl-6' : ''}`}>
      {Icon && (
        <Tooltip content={meta.label}>
          <span className={`inline-flex items-center justify-center w-4 h-4 rounded-full border shrink-0 ${meta.tw}`}>
            <Icon className="w-2.5 h-2.5" aria-hidden />
          </span>
        </Tooltip>
      )}
      <span className="typo-caption text-foreground truncate">{finding.title}</span>
      <span className="typo-label text-foreground/40 truncate hidden md:inline">· {finding.evidence}</span>
      <span className="ml-auto shrink-0 inline-flex items-center gap-1.5">
        {finding.state === 'dispatched' && (
          <span className="typo-label text-sky-300/80 inline-flex items-center gap-1">
            <Activity className="w-3 h-3 animate-pulse" aria-hidden /> in flight
          </span>
        )}
        {finding.verdict ? <VerdictChip verifyState={finding.verdict} /> : finding.state === 'proposed' ? <DispatchStub subtle /> : null}
      </span>
    </div>
  );
}

// -- header (shared across both variants) -----------------------------------------

export function CockpitHeader({ project }: { project: MockProject }) {
  const wired = project.wiring.filter((x) => x.wired).length;
  const lw = project.loopWeek;
  return (
    <div className="mx-4 mt-3 rounded-card border border-primary/10 bg-card/30 px-4 py-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 className="typo-heading-lg text-foreground">{project.name}</h2>
            <SealPill label="Automation" value={project.automation.level} score={project.automation.score} />
            <SealPill label="Production" value={project.production.band} score={project.production.score} />
          </div>
          <p className="typo-caption text-foreground/50 mt-0.5">{project.purpose}</p>
        </div>
        {/* The loop's week — verdicts are the headline; a regression is never quiet. */}
        {lw && (
          <div className="shrink-0 text-right">
            <div className="typo-label text-foreground/40 uppercase tracking-wide mb-0.5">Loop · this week</div>
            <div className="inline-flex items-center gap-2 typo-caption tabular-nums">
              <span className="text-foreground/70">{lw.raised} raised</span>
              <span className="text-foreground/30">·</span>
              <span className="text-foreground/70">{lw.dispatched} dispatched</span>
              <span className="text-foreground/30">·</span>
              {lw.cleared > 0 && <span className="text-emerald-300">{lw.cleared} cleared</span>}
              {lw.moved > 0 && <span className="text-sky-300">{lw.moved} moved</span>}
              {lw.unchanged > 0 && <span className="text-amber-300">{lw.unchanged} unchanged</span>}
              {lw.regressed > 0 && (
                <span className="inline-flex items-center gap-1 text-red-300 font-medium">
                  <AlertTriangle className="w-3 h-3" aria-hidden />
                  {lw.regressed} REGRESSED
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      {/* Wiring stamps — the establishment surface, always visible, gaps are CTAs. */}
      <div className="flex items-center gap-1.5 flex-wrap mt-2.5">
        {project.wiring.map((x) => (
          <WiringStamp key={x.key} wiring={x} />
        ))}
        <span className="typo-label text-foreground/35 ml-1 tabular-nums">{wired}/{project.wiring.length} wired</span>
      </div>
    </div>
  );
}

function SealPill({ label, value, score }: { label: string; value: string; score: number }) {
  const tone = score >= 70 ? 'text-emerald-300 border-emerald-500/25 bg-emerald-500/10'
    : score >= 40 ? 'text-amber-300 border-amber-500/25 bg-amber-500/10'
      : 'text-red-300 border-red-500/25 bg-red-500/10';
  return (
    <Tooltip content={`${label} readiness — score ${score}/100 (from the passport scan)`}>
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-pill border typo-label ${tone}`}>
        {label}: {value}
        <span className="tabular-nums opacity-70">{score}</span>
      </span>
    </Tooltip>
  );
}

// -- the bare-tier experience ------------------------------------------------------

/** A bare project must feel like a JOURNEY WITH A FINISH LINE, not a broken
 *  dashboard. Each unwired sensor is a step that names what it unlocks. */
export function EstablishChecklist({ project }: { project: MockProject }) {
  const steps = project.wiring;
  const wired = steps.filter((s) => s.wired).length;
  return (
    <div className="mx-4 my-4 flex-1 flex flex-col items-center justify-center text-center" data-testid="cockpit-establish">
      <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
        <Wrench className="w-7 h-7 text-primary/60" />
      </div>
      <p className="typo-section-title text-foreground">Establish this project</p>
      <p className="typo-caption text-foreground/55 mt-1 max-w-md">
        Nothing is wired yet, so there is nothing honest to measure. Each connection
        below unlocks a dimension of the cockpit — earn the stamps and the numbers appear.
      </p>
      <div className="mt-5 w-full max-w-md space-y-1.5 text-left">
        {steps.map((s, i) => {
          const Icon = WIRING_ICON[s.key];
          return (
            <button
              key={s.key}
              type="button"
              className={`w-full flex items-center gap-3 rounded-modal border px-3 py-2.5 transition-colors focus-ring ${
                s.wired
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-dashed border-primary/20 bg-card/30 hover:border-primary/40 hover:bg-primary/5'
              }`}
            >
              <span className="typo-label text-foreground/35 tabular-nums w-4">{i + 1}</span>
              <Icon className={`w-4 h-4 shrink-0 ${s.wired ? 'text-emerald-300' : 'text-foreground/50'}`} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="typo-caption font-medium text-foreground block">{s.label}</span>
                <span className="typo-label text-foreground/45 block truncate">unlocks {s.unlocks}</span>
              </span>
              {s.wired
                ? <CheckCircle2 className="w-4 h-4 text-emerald-300 shrink-0" aria-hidden />
                : <Sparkles className="w-4 h-4 text-amber-300/70 shrink-0" aria-hidden />}
            </button>
          );
        })}
      </div>
      <p className="typo-label text-foreground/35 mt-3 tabular-nums">{wired}/{steps.length} stamps earned</p>
    </div>
  );
}

// -- section band ------------------------------------------------------------------

export function DimensionBand({ icon, title, hint, children }: { icon: ReactNode; title: string; hint: string; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-1 mb-2">
      <span className="text-primary/70">{icon}</span>
      <h3 className="typo-label uppercase tracking-wide text-foreground/70">{title}</h3>
      <span className="typo-label text-foreground/35">{hint}</span>
      <span className="ml-auto">{children}</span>
    </div>
  );
}
