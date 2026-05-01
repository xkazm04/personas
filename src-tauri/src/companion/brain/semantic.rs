//! Semantic memory: distilled facts about the user, projects, and world.
//! Lives as markdown under `~/.personas/companion-brain/semantic/{user,projects,world}/`.
//!
//! Every fact has non-empty provenance pointing to source episode IDs.
//! Writes without provenance are rejected — this is the anti-hallucination
//! contract enforced at the dispatcher layer.
//!
//! Phase 0: stub. Phase 2: write_fact, query, contradict_check.
