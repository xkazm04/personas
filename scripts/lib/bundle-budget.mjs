// Single source of truth for the JS bundle size budget.
//
// Imported by check-bundle-budget.mjs (the CI gate, as defaults) and
// bundle-size-report.mjs (the PR comment). Previously these two scripts plus
// the ci.yml CLI flags carried three independent copies of 850/5000 that could
// silently disagree (the report would say PASS while the gate said FAIL).
//
// The main index chunk is ~778 KB (systemStore + agentStore + Sidebar); 850 is
// the per-chunk ceiling that leaves headroom without masking real growth.

export const MAX_CHUNK_KB = 850;
export const MAX_TOTAL_KB = 5000;
