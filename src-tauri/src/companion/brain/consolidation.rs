//! Manual on-demand consolidation. Reads recent episodes, proposes
//! semantic-fact updates, flags contradictions. Output is a *diff* the user
//! reviews before any commit — the consolidator never has unilateral write
//! access. This is the anti-hallucination guard for the riskiest LLM call.
//!
//! Scheduled/automatic consolidation is explicitly out of scope for v1.
//!
//! Phase 0: stub. Phase 5: run_consolidation, apply_diff.
