// Dimension registry — the single source of truth for the Mastermind canvas's
// per-project dimensions. Every dimension declares, in ONE place, everything
// the rest of the canvas needs to know about it:
//   • label / category        — identity + (reserved) grouping
//   • derive(passport, extras) — status/detail/progress from a readiness passport
//   • icon / forge             — lucide outline + optional Mastermind-native glyph
//   • rowKey / action          — Passport-wall Improve mapping + actionability kind
//   • payloadKind              — how a far/mid cell renders (generic icon vs a
//                                dedicated numeric payload, e.g. Ideas' day count)
//
// deriveScene, dimMeta, dimActions, DimGlyph and both cell renderers all read
// this registry. Adding a future dimension (Memory, Billing, Integrations…) is
// therefore a ONE-entry change here — see `addingADimension` below.
//
// This module owns no JSX literals (forge geometry lives in dimGlyphsForge, the
// glyph library) so it stays a plain `.ts`.
import {
  Activity, Bot, BrainCircuit, Database, FlaskConical, Gauge, KeyRound,
  Lightbulb, Server, ShieldCheck, Wand2, Workflow, type LucideIcon,
} from 'lucide-react';

import {
  AUTOMATION_LABEL, AUTOMATION_SCALE, CI_SCALE, OBSERVABILITY_SCALE,
  SECURITY_SCALE, TESTS_SCALE, type AppPassport,
} from '@/features/teams/sub_factory/passport/passportModel';

import { FORGE_GLYPH } from './dimGlyphsForge';
import type { DimStatus } from './types';

/** Per-project KPI rollup (Factory data): total active KPIs + off-track count. */
export interface KpiRollup { total: number; off: number }

/** Extra per-project inputs a dimension's derive() may need beyond the passport. */
export interface DimDeriveExtras {
  kpi: KpiRollup | undefined;
  /** ISO timestamp of the last idea scan (null/undefined = never scanned). */
  lastScanAt: string | null | undefined;
}

/** The dynamic fields a dimension computes from a passport. */
export interface DimDerived {
  status: DimStatus;
  detail: string | null;
  reached: number;
  steps: number;
  /** Ideas-style numeric payload — whole days since a timestamp (null = n/a). */
  days?: number | null;
}

/** Reserved for a future category-grouping UI (no grouping UI is built yet). */
export type DimCategory = 'runtime' | 'delivery' | 'agentic' | 'product';

/** Which Improve resolution path a dimension takes (see dimActions.dimAction):
 *  standards = Tier-0 standards popover, deploy = Claude deploy/connector/skills
 *  popover, ideas = the idea-scan dispatch popover, null = never actionable. */
export type DimActionKind = 'standards' | 'deploy' | 'ideas' | null;

/** How a cell renders its far/mid-zoom payload. `icon` = the dimension glyph;
 *  `days` = a large day-counter (Ideas' freshness), glyph shrunk to a corner. */
export type DimPayloadKind = 'icon' | 'days';

export interface DimRegistryEntry {
  label: string;
  category: DimCategory;
  icon: LucideIcon;
  /** Mastermind-native solid glyph; absent → DimGlyph falls back to `icon`. */
  forge?: () => React.ReactNode;
  /** Passport-wall row key this dimension maps to (null = no wall counterpart). */
  rowKey: string | null;
  action: DimActionKind;
  payloadKind: DimPayloadKind;
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

// Canvas node order — the lattice slots map onto this 1:1 (MosaicIsland.AXIAL /
// InverseIsland.RING). DimKey is derived from this tuple (NOT from the registry
// value types) so the key space stays decoupled from FORGE_GLYPH/derive and free
// of circular type references. DO NOT reorder without updating those lattices.
export const DIM_ORDER = [
  'db', 'monitoring', 'ci', 'tests', 'security', 'hosting', 'auth', 'agents',
  'skills', 'llm', 'kpi', 'ideas',
] as const;

/** The dimension key space. A new dimension = add its key here AND its entry to
 *  DIM_REGISTRY below (both in this one file; the Record type keeps them in
 *  lockstep — the compiler flags a key without an entry and vice-versa). */
export type DimKey = typeof DIM_ORDER[number];

// ── The registry. Keyed by DimKey; entries must appear in DIM_ORDER order. ────
export const DIM_REGISTRY: Record<DimKey, DimRegistryEntry> = {
  db: {
    label: 'Database', category: 'runtime', icon: Database, forge: FORGE_GLYPH.db,
    rowKey: 'migrations', action: 'deploy', payloadKind: 'icon',
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
    label: 'Monitoring', category: 'runtime', icon: Activity, forge: FORGE_GLYPH.monitoring,
    rowKey: 'observability', action: 'deploy', payloadKind: 'icon',
    derive: (p) => {
      const monTools = [p.stack.monitoring.errorTracking, p.stack.monitoring.logs, p.stack.monitoring.metrics, p.stack.monitoring.tracing]
        .filter((x): x is string => Boolean(x));
      const obs = ord(OBSERVABILITY_SCALE, p.productionReadiness.observability.level);
      return {
        status: monTools.length === 0 && obs.reached === 0 ? 'absent' : obs.pos >= 0.5 ? 'solid' : 'partial',
        detail: monTools[0] ?? null,
        reached: obs.reached, steps: obs.steps,
      };
    },
  },
  ci: {
    label: 'CI', category: 'delivery', icon: Workflow, forge: FORGE_GLYPH.ci,
    rowKey: 'ci', action: 'standards', payloadKind: 'icon',
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
    label: 'Tests', category: 'delivery', icon: FlaskConical, forge: FORGE_GLYPH.tests,
    rowKey: 'tests', action: 'deploy', payloadKind: 'icon',
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
    label: 'Security', category: 'delivery', icon: ShieldCheck, forge: FORGE_GLYPH.security,
    rowKey: 'security', action: 'deploy', payloadKind: 'icon',
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
    label: 'Hosting', category: 'runtime', icon: Server, forge: FORGE_GLYPH.hosting,
    rowKey: 'hosting', action: 'deploy', payloadKind: 'icon',
    derive: (p) => ({ status: presence(p.stack.hosting), detail: p.stack.hosting ?? null, reached: 0, steps: 0 }),
  },
  auth: {
    label: 'Auth', category: 'runtime', icon: KeyRound, forge: FORGE_GLYPH.auth,
    rowKey: null, action: null, payloadKind: 'icon',
    derive: (p) => ({ status: presence(p.stack.auth), detail: p.stack.auth ?? null, reached: 0, steps: 0 }),
  },
  agents: {
    label: 'Agents', category: 'agentic', icon: Bot, forge: FORGE_GLYPH.agents,
    rowKey: 'aiflow', action: 'deploy', payloadKind: 'icon',
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
    label: 'Skills', category: 'agentic', icon: Wand2, forge: FORGE_GLYPH.skills,
    rowKey: 'skills', action: 'deploy', payloadKind: 'icon',
    derive: (p) => ({ status: p.automationReadiness.artifacts.skills ? 'solid' : 'absent', detail: p.automationReadiness.artifacts.skills ? 'installed' : null, reached: 0, steps: 0 }),
  },
  llm: {
    label: 'LLM cost', category: 'agentic', icon: BrainCircuit, forge: FORGE_GLYPH.llm,
    rowKey: 'llmtracking', action: 'deploy', payloadKind: 'icon',
    derive: (p) => ({ status: p.stack.llmTracking ? 'solid' : 'absent', detail: p.stack.llmTracking ?? null, reached: 0, steps: 0 }),
  },
  kpi: {
    label: 'KPIs', category: 'product', icon: Gauge, forge: FORGE_GLYPH.kpi,
    rowKey: null, action: null, payloadKind: 'icon',
    derive: (_p, { kpi }) => ({
      status: !kpi || kpi.total === 0 ? 'absent' : kpi.off > 0 ? 'alert' : 'solid',
      detail: !kpi || kpi.total === 0 ? null : kpi.off > 0 ? `${kpi.off} off-track` : `${kpi.total} on track`,
      reached: 0, steps: 0,
    }),
  },
  ideas: {
    // Freshness bands: green <7d, amber 7–30d, red >30d, grey when never scanned.
    label: 'Ideas', category: 'product', icon: Lightbulb, forge: FORGE_GLYPH.ideas,
    rowKey: null, action: 'ideas', payloadKind: 'days',
    derive: (_p, { lastScanAt }) => {
      const days = lastScanAt ? Math.max(0, Math.floor((Date.now() - new Date(lastScanAt).getTime()) / 86_400_000)) : null;
      return {
        status: days === null ? 'absent' : days < 7 ? 'solid' : days <= 30 ? 'risk' : 'alert',
        detail: days === null ? null : days === 0 ? 'today' : `${days}d ago`,
        reached: 0, steps: 0, days,
      };
    },
  },
};

// addingADimension:
//   1. In THIS file: add the key to DIM_ORDER and its entry to DIM_REGISTRY
//      (label/category/icon/derive/rowKey/action/payloadKind; `forge` optional —
//      omit it to fall back to `icon`). deriveScene/dimMeta/dimActions/DimGlyph
//      and both cell renderers pick it up with no further edits.
//   2. Open a lattice slot for it: add a [q,r] coord to MosaicIsland.AXIAL AND a
//      [col,row] coord to InverseIsland.RING (both currently hold 12 — the 13th+
//      slots are the only render-side change a new dimension needs).
