// Dimension registry — the single source of truth for Mastermind's per-project
// dimensions (Soundings calls them readings). Every dimension declares, in ONE
// place, everything the rest of Mastermind needs to know about it:
//   • label / category        — identity + the Soundings lane it sits in
//   • derive(passport, extras) — status/detail/progress from a readiness passport
//   • rowKey / action          — Passport-wall Improve mapping + actionability kind
//
// deriveScene, dimActions and Soundings all read this registry. Adding a future
// dimension (Memory, Billing, Integrations…) is therefore a ONE-entry change
// here — see `addingADimension` below.
//
// This module owns no JSX literals, so it stays a plain `.ts`.
import {
  AUTOMATION_LABEL, AUTOMATION_SCALE, CI_SCALE, OBSERVABILITY_SCALE,
  SECURITY_SCALE, TESTS_SCALE, type AppPassport,
} from '@/features/teams/sub_factory/passport/passportModel';

import type { DimStatus } from './types';

/** Per-project KPI rollup (Factory data): total active KPIs + off-track count. */
export interface KpiRollup { total: number; off: number }

/** Extra per-project inputs a dimension's derive() may need beyond the passport. */
export interface DimDeriveExtras {
  kpi: KpiRollup | undefined;
  /** ISO timestamp of the last idea scan (null/undefined = never scanned). */
  lastScanAt: string | null | undefined;
  /** Live unresolved-issue count from the bound monitoring credential.
   *  `undefined` = no supported credential bound (readiness-only); a number
   *  (incl. 0) = a live reading the Monitoring cell should surface. */
  monitorErrors?: number | null;
  /** True when the idea-scan family hard-failed to load — the Ideas cell then
   *  renders `unknown` (data unavailable) instead of a fake "never scanned". */
  scansUnknown?: boolean;
  /** True when the KPI/Factory family hard-failed to load — the KPI cell then
   *  renders `unknown` instead of a fake "absent". */
  kpiUnknown?: boolean;
  /** Number of ongoing (not done) dev goals for this project. */
  goalsOngoing?: number;
  /** True when the goals family hard-failed to load — the Goals cell then
   *  renders `unknown` instead of a fake "no goals". */
  goalsUnknown?: boolean;
}

/** The dynamic fields a dimension computes from a passport. */
export interface DimDerived {
  status: DimStatus;
  detail: string | null;
  reached: number;
  steps: number;
  /** Numeric reading: whole days since the last idea scan (Ideas) or the
   *  ongoing-goal count (Goals). Null = no number to show. */
  days?: number | null;
}

/** The lane a reading sits in on a Soundings station (soundingsModel.LANES). */
export type DimCategory = 'runtime' | 'delivery' | 'agentic' | 'product';

/** Which Improve resolution path a dimension takes (see dimActions.dimAction):
 *  standards = Tier-0 standards popover, deploy = Claude deploy/connector/skills
 *  popover, ideas = the idea-scan dispatch popover, goals = the active-goal
 *  list popover, kpi = the project-KPI list popover, stack-list = the generic
 *  name-list popover for declaration-only dimensions (data links, support
 *  channels), skills-run = the "run an installed skill via Fleet" modal (green
 *  Skills cell only), null = never actionable. */
export type DimActionKind = 'standards' | 'deploy' | 'ideas' | 'goals' | 'kpi' | 'stack-list' | 'skills-run' | null;

export interface DimRegistryEntry {
  label: string;
  category: DimCategory;
  /** Passport-wall row key this dimension maps to (null = no wall counterpart). */
  rowKey: string | null;
  action: DimActionKind;
  /** True for dimensions that are inert BY DESIGN, not by omission — the
   *  passport reports them read-only and the wall offers no row action either
   *  (`auth`). The cells say so in their tooltip instead of leaving the user
   *  clicking a dead square. A dimension that is merely un-wired yet does NOT
   *  belong here; it belongs in a future action kind. */
  viewOnly?: boolean;
  derive: (p: AppPassport, extras: DimDeriveExtras) => DimDerived;
}

/** Ordinal progress of value `v` within `scale`: reached index, total steps,
 *  and a 0..1 position. Mirrors the Passport wall's scale handling. */
const ord = <T extends string>(scale: T[], v: T) => {
  const i = Math.max(0, scale.indexOf(v));
  return { reached: i, steps: scale.length - 1, pos: scale.length > 1 ? i / (scale.length - 1) : 0 };
};

/** Boolean-presence dimensions: solid when a value exists, absent otherwise. */
const presence = (v: string | null | undefined): DimStatus => (v ? 'solid' : 'absent');

// Dimension order — the order readings are listed in. DimKey is derived from
// this tuple (NOT from the registry value types) so the key space stays
// decoupled from the entry value types and free of circular type references.
export const DIM_ORDER = [
  'db', 'monitoring', 'ci', 'tests', 'security', 'hosting', 'auth', 'agents',
  'skills', 'llm', 'kpi', 'ideas', 'goals', 'datalinks', 'support',
] as const;

/** The dimension key space. A new dimension = add its key here AND its entry to
 *  DIM_REGISTRY below (both in this one file; the Record type keeps them in
 *  lockstep — the compiler flags a key without an entry and vice-versa). */
export type DimKey = typeof DIM_ORDER[number];

// ── The registry. Keyed by DimKey; entries must appear in DIM_ORDER order. ────
export const DIM_REGISTRY: Record<DimKey, DimRegistryEntry> = {
  db: {
    // `persistence`, not `migrations`: the cell is LABELLED Database and derives
    // from `stack.persistence`, so pointing its click at the migrations row sent
    // it to a surface about something else — and, once Database grew a real
    // modal, meant the canvas silently kept opening the generic deploy popover.
    label: 'Database', category: 'runtime',
    rowKey: 'persistence', action: 'deploy',
    derive: (p) => {
      const db = p.stack.persistence.filter((x) => x.kind !== 'none');
      return {
        status: db.length === 0 ? 'absent' : db.some((x) => x.migrations && x.migrations !== 'none') ? 'solid' : 'partial',
        detail: db.map((x) => x.engine ?? x.kind).join(' · ') || null,
        reached: 0, steps: 0,
      };
    },
  },
  monitoring: {
    // Same correction as `db`: the wall's Monitoring row key is `monitoring`.
    // `observability` is a different (ordinal) row, and routing here sent the
    // canvas to the deploy popover instead of the Monitoring modal.
    label: 'Monitoring', category: 'runtime',
    rowKey: 'monitoring', action: 'deploy',
    derive: (p, { monitorErrors }) => {
      const monTools = [p.stack.monitoring.errorTracking, p.stack.monitoring.logs, p.stack.monitoring.metrics, p.stack.monitoring.tracing]
        .filter((x): x is string => Boolean(x));
      const obs = ord(OBSERVABILITY_SCALE, p.productionReadiness.observability.level);
      // Live error count from a bound monitoring credential takes over the cell:
      // open issues flip it to alert and name the count next to the tool. When
      // no credential is bound (monitorErrors == null/undefined) the cell keeps
      // its static observability-wiring derivation (honest fallback).
      if (monitorErrors != null && monitorErrors > 0) {
        return {
          status: 'alert',
          detail: `${monTools[0] ?? 'Sentry'} · ${monitorErrors}`,
          reached: obs.reached, steps: obs.steps,
        };
      }
      return {
        status: monTools.length === 0 && obs.reached === 0 ? 'absent' : obs.pos >= 0.5 ? 'solid' : 'partial',
        detail: monTools[0] ?? null,
        reached: obs.reached, steps: obs.steps,
      };
    },
  },
  ci: {
    label: 'CI', category: 'delivery',
    rowKey: 'ci', action: 'standards',
    derive: (p) => {
      const ci = ord(CI_SCALE, p.productionReadiness.ci.level);
      return {
        status: ci.reached === 0 ? 'absent' : ci.pos >= 0.5 ? 'solid' : 'partial',
        detail: p.productionReadiness.ci.provider ?? null,
        reached: ci.reached, steps: ci.steps,
      };
    },
  },
  tests: {
    label: 'Tests', category: 'delivery',
    rowKey: 'tests', action: 'deploy',
    derive: (p) => {
      const tests = ord(TESTS_SCALE, p.productionReadiness.tests.level);
      return {
        status: tests.reached === 0 ? 'absent' : tests.pos >= 0.7 ? 'solid' : tests.pos >= 0.5 ? 'partial' : 'risk',
        detail: p.productionReadiness.tests.coveragePct != null ? `${p.productionReadiness.tests.coveragePct}% cov` : p.productionReadiness.tests.frameworks?.[0] ?? null,
        reached: tests.reached, steps: tests.steps,
      };
    },
  },
  security: {
    label: 'Security', category: 'delivery',
    rowKey: 'security', action: 'deploy',
    derive: (p) => {
      const sec = ord(SECURITY_SCALE, p.productionReadiness.security.level);
      return {
        status: sec.reached === 0 ? 'absent' : sec.pos >= 0.5 ? 'solid' : 'partial',
        detail: p.productionReadiness.security.tools?.[0] ?? null,
        reached: sec.reached, steps: sec.steps,
      };
    },
  },
  hosting: {
    label: 'Hosting', category: 'runtime',
    rowKey: 'hosting', action: 'deploy',
    derive: (p) => ({ status: presence(p.stack.hosting), detail: p.stack.hosting ?? null, reached: 0, steps: 0 }),
  },
  auth: {
    // View-only by design: `stack.auth` is a detection, not a setting. There is
    // no `auth` row in deployActions/connectors and the wall renders it as a
    // plain presence cell, so a canvas action here would break dimActions'
    // invariant that a cell is clickable exactly when its wall row shows a gear.
    label: 'Auth', category: 'runtime',
    rowKey: null, action: null, viewOnly: true,
    derive: (p) => ({ status: presence(p.stack.auth), detail: p.stack.auth ?? null, reached: 0, steps: 0 }),
  },
  agents: {
    label: 'Agents', category: 'agentic',
    rowKey: 'aiflow', action: 'deploy',
    derive: (p) => {
      const agents = ord(AUTOMATION_SCALE, p.automationReadiness.level);
      return {
        status: agents.pos >= 0.75 ? 'solid' : agents.pos >= 0.5 ? 'partial' : 'risk',
        detail: AUTOMATION_LABEL[p.automationReadiness.level],
        reached: agents.reached, steps: agents.steps,
      };
    },
  },
  skills: {
    label: 'Skills', category: 'agentic',
    rowKey: 'skills', action: 'deploy',
    derive: (p) => ({ status: p.automationReadiness.artifacts.skills ? 'solid' : 'absent', detail: p.automationReadiness.artifacts.skills ? 'installed' : null, reached: 0, steps: 0 }),
  },
  llm: {
    label: 'LLM cost', category: 'agentic',
    rowKey: 'llmtracking', action: 'deploy',
    derive: (p) => ({ status: p.stack.llmTracking ? 'solid' : 'absent', detail: p.stack.llmTracking ?? null, reached: 0, steps: 0 }),
  },
  kpi: {
    // Click lists the project's KPIs worst-first (KpiListPopover). The cell has
    // no Passport-wall counterpart — KPIs live in the Factory, not the wall —
    // so the action is its own kind rather than a rowKey mapping. The page
    // downgrades a cell with zero KPIs to inert (nothing to list).
    label: 'KPIs', category: 'product',
    rowKey: null, action: 'kpi',
    derive: (_p, { kpi, kpiUnknown }) => {
      if (kpiUnknown) return { status: 'unknown', detail: null, reached: 0, steps: 0 };
      return {
        status: !kpi || kpi.total === 0 ? 'absent' : kpi.off > 0 ? 'alert' : 'solid',
        detail: !kpi || kpi.total === 0 ? null : kpi.off > 0 ? `${kpi.off} off-track` : `${kpi.total} on track`,
        reached: 0, steps: 0,
      };
    },
  },
  ideas: {
    // Freshness bands: green <7d, amber 7–30d, red >30d, grey when never scanned.
    label: 'Ideas', category: 'product',
    rowKey: null, action: 'ideas',
    derive: (_p, { lastScanAt, scansUnknown }) => {
      if (scansUnknown) return { status: 'unknown', detail: null, reached: 0, steps: 0, days: null };
      const days = lastScanAt ? Math.max(0, Math.floor((Date.now() - new Date(lastScanAt).getTime()) / 86_400_000)) : null;
      return {
        status: days === null ? 'absent' : days < 7 ? 'solid' : days <= 30 ? 'risk' : 'alert',
        detail: days === null ? null : days === 0 ? 'today' : `${days}d ago`,
        reached: 0, steps: 0, days,
      };
    },
  },
  goals: {
    // Ongoing (not done) dev goals. Count > 0 paints the reading active (info)
    // and carries the count; 0 = a grey reading ("no active goals" is honest,
    // not a gap). Click lists the goal names.
    label: 'Goals', category: 'product',
    rowKey: null, action: 'goals',
    derive: (_p, { goalsOngoing, goalsUnknown }) => {
      if (goalsUnknown) return { status: 'unknown', detail: null, reached: 0, steps: 0, days: null };
      const n = goalsOngoing ?? 0;
      return {
        status: n > 0 ? 'partial' : 'absent',
        detail: n > 0 ? `${n} active` : null,
        reached: 0, steps: 0,
        days: n > 0 ? n : null,
      };
    },
  },
  // The two prototype passport dimensions (2026-07-23) — deliberately binary
  // (grey absent / green solid). They have no wall counterpart and nothing to
  // deploy; what they DO have is a declared list, so the click just names it
  // (stack-list). The page downgrades an empty list to inert.
  datalinks: {
    label: 'Data analysis', category: 'product',
    rowKey: null, action: 'stack-list',
    derive: (p) => {
      const links = p.stack.dataLinks ?? [];
      return { status: links.length > 0 ? 'solid' : 'absent', detail: links.join(' · ') || null, reached: 0, steps: 0 };
    },
  },
  support: {
    label: 'Support', category: 'product',
    rowKey: null, action: 'stack-list',
    derive: (p) => {
      const channels = p.stack.supportChannels ?? [];
      return { status: channels.length > 0 ? 'solid' : 'absent', detail: channels.join(' · ') || null, reached: 0, steps: 0 };
    },
  },
};

// addingADimension:
//   1. In THIS file: add the key to DIM_ORDER and its entry to DIM_REGISTRY
//      (label/category/derive/rowKey/action). deriveScene, dimActions and
//      Soundings (which places it in its category's lane) pick it up with no
//      further edits.
