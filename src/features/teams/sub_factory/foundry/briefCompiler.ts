// Crew Foundry brief compiler — PURE functions only (unit-tested; no I/O).
//
// Turns the project's live telemetry (pulse narrative + tensions, context
// incident heat, passport dimension gaps, off-track KPIs) into (a) a synthesis
// brief and (b) explicit role directives, so the forged crew maps to the
// project's ACTUAL deficits rather than generic dev roles. The Rust side
// (`synthesize_project_crew`) injects both into the deficit-steered prompt.
import {
  type AppPassport,
  CI_SCALE, DOCS_SCALE, MEMORY_SCALE, MIGRATIONS_SCALE, OBSERVABILITY_SCALE,
  SECURITY_SCALE, TESTS_SCALE, scalePos,
  CI_LABEL, DOCS_LABEL, MEMORY_LABEL, MIGRATIONS_LABEL, OBSERVABILITY_LABEL,
  SECURITY_LABEL, TESTS_LABEL,
} from '../passport/passportModel';

/** Mirror of the Rust `MAX_QUERY_LENGTH` sanitizer cap — anything longer is
 *  truncated server-side, so the compiler owns the trim and does it well. */
export const MAX_BRIEF_CHARS = 2000;

export interface CrewBriefContext {
  name: string;
  /** Runtime error count (Sentry heat); null when monitoring isn't wired. */
  errorCount: number | null;
  goalCount: number;
}

export interface PassportGap {
  /** Human dimension name, e.g. "Tests". */
  dimension: string;
  /** Human level label, e.g. "Smoke". */
  level: string;
  /** 0..1, higher = worse (1 = bottom of the scale). */
  severity: number;
}

export interface CrewBriefOffTrackKpi {
  name: string;
  contextName: string | null;
  current: number | null;
  target: number | null;
  unit: string;
}

export interface CrewBriefPulse {
  narrativeMd: string;
  tensions: string[];
  directions: string[];
}

export interface CrewBriefInput {
  projectName: string;
  /** Cross-project scan summary; null when never scanned. */
  summary: string | null;
  /** Latest pulse (tensions may be merged across recent days); null when
   *  project tracking has produced none. */
  pulse: CrewBriefPulse | null;
  contexts: CrewBriefContext[];
  passportGaps: PassportGap[];
  offTrackKpis: CrewBriefOffTrackKpi[];
}

export interface RoleDirective {
  /** Short role handle, e.g. "Reliability". */
  role: string;
  /** One-line focus statement anchored to a named deficit. */
  focus: string;
}

export interface CompiledCrewBrief {
  /** The synthesis brief, <= MAX_BRIEF_CHARS. */
  brief: string;
  roleDirectives: RoleDirective[];
  /** Human-readable deficit list (drives UI preview + honest empty state). */
  deficits: string[];
}

// -- passport gap derivation ---------------------------------------------------

/** Ordinal dimensions considered by the foundry, weakest-first. Only
 *  dimensions in the bottom half of their scale count as gaps — a "Substantial"
 *  test suite is not a deficit worth staffing against. */
export function derivePassportGaps(passport: AppPassport): PassportGap[] {
  const prod = passport.productionReadiness;
  const art = passport.automationReadiness.artifacts;
  const dims: Array<{ dimension: string; severity: number; level: string }> = [
    { dimension: 'Tests', severity: 1 - scalePos(TESTS_SCALE, prod.tests.level), level: TESTS_LABEL[prod.tests.level] },
    { dimension: 'CI', severity: 1 - scalePos(CI_SCALE, prod.ci.level), level: CI_LABEL[prod.ci.level] },
    { dimension: 'Security', severity: 1 - scalePos(SECURITY_SCALE, prod.security.level), level: SECURITY_LABEL[prod.security.level] },
    { dimension: 'Observability', severity: 1 - scalePos(OBSERVABILITY_SCALE, prod.observability.level), level: OBSERVABILITY_LABEL[prod.observability.level] },
    { dimension: 'Migrations', severity: 1 - scalePos(MIGRATIONS_SCALE, prod.delivery.migrations), level: MIGRATIONS_LABEL[prod.delivery.migrations] },
    { dimension: 'Docs', severity: 1 - scalePos(DOCS_SCALE, art.docs), level: DOCS_LABEL[art.docs] },
    { dimension: 'Memory', severity: 1 - scalePos(MEMORY_SCALE, art.memory), level: MEMORY_LABEL[art.memory] },
  ];
  return dims
    .filter((d) => d.severity > 0.5)
    .sort((a, b) => b.severity - a.severity)
    .map((d) => ({ dimension: d.dimension, level: d.level, severity: d.severity }));
}

// -- role mapping --------------------------------------------------------------

const GAP_ROLE: Record<string, string> = {
  Tests: 'QA',
  CI: 'Release',
  Security: 'Security',
  Observability: 'Observability',
  Migrations: 'Data',
  Docs: 'Docs',
  Memory: 'Knowledge',
};

const fmtNum = (v: number | null): string => (v == null ? '—' : String(Math.round(v * 100) / 100));

/** Max members a synthesis produces is 5 — directives beyond that dilute the
 *  selection, so the compiler keeps the highest-signal five. */
const MAX_DIRECTIVES = 5;

// -- the compiler --------------------------------------------------------------

export function compileCrewBrief(input: CrewBriefInput): CompiledCrewBrief {
  const deficits: string[] = [];
  const directives: RoleDirective[] = [];

  // 1) Incident heat → a Reliability persona anchored to the hottest contexts.
  const hot = input.contexts
    .filter((c): c is CrewBriefContext & { errorCount: number } => (c.errorCount ?? 0) > 0)
    .sort((a, b) => b.errorCount - a.errorCount)
    .slice(0, 3);
  if (hot.length > 0) {
    const anchor = hot.map((c) => `${c.name} (${c.errorCount} errors)`).join(', ');
    deficits.push(`Incident heat: ${anchor}`);
    directives.push({
      role: 'Reliability',
      focus: `Reliability persona anchored to the contexts with incident heat: ${anchor}`,
    });
  }

  // 2) Off-track KPIs → one KPI-driver directive naming every miss.
  if (input.offTrackKpis.length > 0) {
    const kpiLines = input.offTrackKpis
      .slice(0, 4)
      .map((k) => `${k.name} at ${fmtNum(k.current)}/${fmtNum(k.target)} ${k.unit}${k.contextName ? ` in ${k.contextName}` : ''}`);
    deficits.push(`Off-track KPIs: ${kpiLines.join('; ')}`);
    directives.push({
      role: 'KPI driver',
      focus: `Persona driving the off-track KPIs back to target: ${kpiLines.join('; ')}`,
    });
  }

  // 3) Passport gaps → one specialist per weak dimension (weakest first).
  for (const gap of input.passportGaps.slice(0, 2)) {
    const role = GAP_ROLE[gap.dimension] ?? gap.dimension;
    deficits.push(`Weak passport dimension: ${gap.dimension} (${gap.level})`);
    directives.push({
      role,
      focus: `${role} persona on the project's weakest passport dimension: ${gap.dimension} is at "${gap.level}"`,
    });
  }

  // 4) Always: an implementer anchored to where the goals actually live.
  const goalCtx = input.contexts
    .filter((c) => c.goalCount > 0)
    .sort((a, b) => b.goalCount - a.goalCount)
    .slice(0, 3)
    .map((c) => `${c.name} (${c.goalCount} goals)`);
  directives.push({
    role: 'Implementer',
    focus: goalCtx.length > 0
      ? `Implementer persona working the open goals, concentrated in: ${goalCtx.join(', ')}`
      : 'Implementer persona for the project’s open goals',
  });

  // Pulse tensions are deficits too (they steer the narrative section).
  const tensions = input.pulse?.tensions.filter((t) => t.trim().length > 0) ?? [];

  // -- assemble the brief text, trimming the narrative first when over cap ----
  const head = [
    `Project: ${input.projectName}`,
    input.summary ? `Summary: ${input.summary}` : null,
  ].filter((s): s is string => s !== null);

  const deficitSection = deficits.length > 0
    ? `Deficits:\n${deficits.map((d) => `- ${d}`).join('\n')}`
    : 'Deficits: none detected — telemetry is thin; staff a minimal generalist crew.';

  const tensionSection = tensions.length > 0
    ? `Tensions:\n${tensions.slice(0, 5).map((t) => `- ${t}`).join('\n')}`
    : null;

  const fixed = [
    ...head,
    deficitSection,
    ...(tensionSection ? [tensionSection] : []),
  ].join('\n\n');

  let brief = fixed;
  const narrative = input.pulse?.narrativeMd.trim() ?? '';
  if (narrative.length > 0) {
    const room = MAX_BRIEF_CHARS - fixed.length - '\n\nPulse:\n'.length;
    if (room > 40) {
      const clipped = narrative.length > room ? `${narrative.slice(0, room - 1)}…` : narrative;
      brief = `${fixed}\n\nPulse:\n${clipped}`;
    }
  }
  if (brief.length > MAX_BRIEF_CHARS) brief = brief.slice(0, MAX_BRIEF_CHARS);

  return {
    brief,
    roleDirectives: directives.slice(0, MAX_DIRECTIVES),
    deficits,
  };
}

/** Wire shape for the Rust command: one line per directive. */
export function directiveLines(compiled: CompiledCrewBrief): string[] {
  return compiled.roleDirectives.map((d) => d.focus);
}
