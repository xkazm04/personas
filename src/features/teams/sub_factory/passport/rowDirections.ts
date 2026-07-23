// R20 — the wall's direction-prompt library for the unified setup rows.
//
// Design rules (2026-07-22 review):
//   • SKILLS FIRST, prompts second. Every dispatch opens by telling the agent
//     to look for a matching skill in the target repo (`.claude/skills/`) and
//     the user's global library (`~/.claude/skills/`) and FOLLOW IT if found —
//     the hard prompt below is the fallback, not the plan. This composes with
//     the wall's skills cell (adopt/share): the more skills a repo adopts, the
//     less these generic prompts matter.
//   • Generic and outcome-oriented — name the outcome and the quality bar,
//     not a step list; the agent discovers the repo's conventions itself.
//   • The security scan direction follows the Claude Security plugin's report
//     discipline (claude-plugins-official/claude-security): severity is IMPACT
//     (HIGH/MEDIUM/LOW), confidence is separate; coverage — what was NOT
//     examined and why — is part of the result; findings lead with impact and
//     cite file:line with a root-cause fix at the sink; no hedging.
export interface RowDirection {
  id: string;
  label: string;
  hint: string;
  /** Outcome-oriented body; the shared preamble/contract wrap it at build time. */
  body: string;
  /** Skill names worth matching in the repo/global library for this direction. */
  skillHints: string[];
}

export const ROW_DIRECTIONS: Record<string, RowDirection[]> = {
  tests: [
    {
      id: 'g-tests-scan', label: 'Scan test coverage', hint: 'map the suite, rank the untested critical paths',
      skillHints: ['verify', 'test', 'coverage'],
      body: 'Produce a coverage picture of this repository: what the suite actually protects, which critical paths are untested, ranked by the cost of a silent regression. Report only — no code changes. State plainly what you did not examine.',
    },
    {
      id: 'g-tests-harden', label: 'Harden critical paths', hint: 'tests where a regression hurts most',
      skillHints: ['test', 'verify'],
      body: 'Add tests where a regression would hurt most. Follow the suite’s existing conventions and tooling; prefer few high-value tests over broad shallow ones. One covered path per commit.',
    },
    {
      id: 'g-tests-stabilize', label: 'Stabilize the suite', hint: 'make green trustworthy',
      skillHints: ['test', 'flaky'],
      body: 'Make the suite’s green trustworthy: identify flaky or misleading tests, fix the root causes you can, quarantine the rest with a tracking note. Finish with what still cannot be trusted and why.',
    },
  ],
  security: [
    {
      id: 'g-sec-scan', label: 'Security review', hint: 'impact-ranked findings, honest coverage',
      skillHints: ['security-review', 'claude-security', 'security'],
      body: 'Run a security review of this repository (read-only — never execute its code). Rank findings by IMPACT: HIGH = system control or broad cross-user data exposure, MEDIUM = real harm with limits, LOW = defense in depth; state confidence separately per finding. Each finding: impact first, exact file:line, the untrusted-source → dangerous-sink path, a concrete exploit scenario, preconditions, and the root-cause fix at the sink. Open the report with coverage — what was examined, what was NOT, and why. No hedging: a clean report with honest coverage beats a page of maybes.',
    },
    {
      id: 'g-sec-harden', label: 'Harden inputs & authz', hint: 'fix at the sink, prove with a test',
      skillHints: ['security-review', 'security'],
      body: 'Harden the riskiest input boundaries and authorization checks: fix at the sink (not one caller), cover each fix with a test that would have caught the hole. One boundary per commit.',
    },
    {
      id: 'g-sec-gate', label: 'Gate CI with security checks', hint: 'catch regressions in the pipeline',
      skillHints: ['security-review', 'ci'],
      body: 'Add security gates to CI appropriate to this stack (dependency audit, static analysis, secret scanning). Keep them fast and actionable, and document how to triage a false positive.',
    },
  ],
  evals: [
    {
      id: 'g-evals-scan', label: 'Scan LLM call sites', hint: 'eval coverage ranked by blast radius',
      skillHints: ['tiger', 'eval'],
      body: 'Inventory every LLM call site (prompt, model, output contract) and rank by blast radius. Report which have evals, which do not, and the minimal assertion a first eval per site should pin. Report only — no code changes.',
    },
    {
      id: 'g-evals-author', label: 'Author evals for critical flows', hint: 'pin behaviors that must not regress',
      skillHints: ['eval'],
      body: 'Author evals for the most critical LLM flows using the repo’s existing eval tooling (introduce the smallest possible harness only if none exists). Golden inputs, expected-output assertions. One flow per commit.',
    },
    {
      id: 'g-evals-ci', label: 'Wire evals into CI', hint: 'run on prompt-touching changes',
      skillHints: ['eval', 'ci'],
      body: 'Wire the existing evals into CI so they run on changes touching prompts or LLM plumbing. Fast subset on PR, full on main; failures must say which behavior moved.',
    },
  ],
  migrations: [
    {
      id: 'g-mig-scan', label: 'Scan schema drift', hint: 'live schema vs migrations story',
      skillHints: ['migration', 'schema'],
      body: 'Compare the actual schema with the migrations history: drift, undocumented structures, destructive patterns. Report findings ranked by risk. Report only — no code changes.',
    },
    {
      id: 'g-mig-version', label: 'Version the migrations', hint: 'ordered, reproducible, clean bootstrap',
      skillHints: ['migration'],
      body: 'Bring the migrations story to ordered and reproducible: a clean bootstrap for a fresh database, ad-hoc changes folded into the sequence. Atomic commits.',
    },
    {
      id: 'g-mig-rollback', label: 'Add rollback safety', hint: 'a way back per migration',
      skillHints: ['migration'],
      body: 'Give every migration a way back: down-migrations where the framework supports them, documented recovery steps where it does not. Verify the down-path on the most recent migration.',
    },
  ],
};

/** Compose the dispatch prompt: skills-first preamble → direction body →
 *  optional user instructions → the working contract. */
export function buildDirectionPrompt(args: {
  projectName: string;
  direction: Pick<RowDirection, 'body' | 'skillHints'>;
  instruction?: string;
}): string {
  const { projectName, direction, instruction } = args;
  const skills = direction.skillHints.join(', ');
  return (
    `Project “${projectName}”. ` +
    `Before anything else, check this repository’s .claude/skills/ and the global ~/.claude/skills/ for a skill matching this direction (names like: ${skills}); if one exists, follow that skill instead of the generic plan below. ` +
    direction.body +
    (instruction?.trim() ? ` Additional instructions from the operator: ${instruction.trim()}.` : '') +
    ' Work in this repository, commit atomically with clear messages, and finish with a short report: what changed, what you verified, what remains.'
  );
}
