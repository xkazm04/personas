// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { SCOPE_FOR_KIND } from '../scopeForKind';

// GATE OVER THE ARTIFACT. Which scope releases a kind from a `scope` breach is
// decided in Rust (`route_signed_kind` and `RouterAct::scope`,
// mandate_router.rs). The Breach card's Widen amend applies it; this test
// parses the Rust law at run time instead of holding a copy of it.
const ROUTER_RS = resolve(__dirname, '../../../../../src-tauri/engine/src/mandate_router.rs');

/** DecideScope variant (Rust) -> its wire spelling. */
const WIRE: Record<string, string> = {
  IdeaAccept: 'idea.accept',
  QuestionAnswer: 'question.answer',
  IncidentTriage: 'incident.triage',
  ReviewInfo: 'review.info',
  ReportRead: 'report.read',
};

function rustLaw(): Map<string, string> {
  const src = readFileSync(ROUTER_RS, 'utf8');
  const out = new Map<string, string>();
  // A kind the steward decides under one scope: `RouteKind::X => scope_or_breach(DecideScope::Y, ...)`.
  for (const m of src.matchAll(/RouteKind::(\w+) => scope_or_breach\(DecideScope::(\w+)/g)) out.set(m[1]!, WIRE[m[2]!] ?? m[2]!);
  // A kind the router files under one act: `RouteKind::X => act_or(RouterAct::Y, ...)` (non-stop incidents).
  const actScope = new Map<string, string>();
  for (const m of src.matchAll(/Self::(\w+) => DecideScope::(\w+),/g)) actScope.set(m[1]!, WIRE[m[2]!] ?? m[2]!);
  for (const m of src.matchAll(/RouteKind::(\w+) => act_or\(\s*RouterAct::(\w+)/g)) {
    const scope = actScope.get(m[2]!);
    if (scope) out.set(m[1]!, scope);
  }
  return out;
}

describe('scopeForKind <-> mandate_router.rs parity', () => {
  it('finds the Rust law it claims to follow', () => {
    // A parse that matched nothing must not report clean.
    expect(rustLaw().size).toBeGreaterThanOrEqual(4);
  });

  it('releases each frontend kind by exactly the scope the router reads', () => {
    const law = rustLaw();
    expect(law.get('Idea')).toBe(SCOPE_FOR_KIND.idea);
    expect(law.get('Question')).toBe(SCOPE_FOR_KIND.question);
    expect(law.get('Incident')).toBe(SCOPE_FOR_KIND.incident);
  });

  it('holds no kind the router does not release by one scope', () => {
    expect(Object.keys(SCOPE_FOR_KIND).sort()).toEqual(['idea', 'incident', 'question']);
  });
});
