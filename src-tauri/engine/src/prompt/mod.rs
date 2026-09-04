//! Runtime persona prompt assembly. See [`README.md`](./README.md) for the
//! module map, prompt sections, and invariants.
//!
//! Split out of the former 3,092-line `prompt/mod.rs`, which held the whole
//! assembler plus a 2,071-line test block. The cut moves no logic:
//!
//! - [`assemble`] — [`assemble_prompt`], [`assemble_prompt_with_skills`] and
//!   the two helpers that only it uses ([`wrap_untrusted_section`] and the
//!   correction-required renderer), plus [`ResolvedConnectorHint`].
//! - `discipline` — `DisciplineMode`, its parameter parsing, and the
//!   deep-fan-out directive gate.
//! - `tests` — the unit tests, one module per thing under test.
//!
//! Everything stays reachable as `personas_engine::prompt::X`; the re-exports
//! below preserve the pre-split surface exactly.

mod advisory;
mod assemble;
mod budget;
mod capabilities;
mod cli_args;
mod core_section;
mod discipline;
mod resume_prompt;
mod runtime_safety;
mod templates;
mod variables;

pub use budget::{fnv1a_64, warn_over_budget, PromptBlockSizes};
pub use capabilities::{
    active_capabilities_fingerprint, build_tool_documentation, core_fingerprint,
    parse_model_profile, render_capability_policy_lines, resolve_use_case_model_override,
    DEFAULT_CAPABILITY_MODEL,
};
pub use cli_args::{apply_provider_env, build_cli_args, build_resume_cli_args, DEFAULT_EFFORT};
pub use core_section::{
    manifest_body, render_legacy_core_prose, render_responsibilities,
    render_responsibility_focused, SELF_MODEL_OP_ADDENDUM,
};
pub use resume_prompt::assemble_resume_prompt;
pub use variables::replace_variables;

#[cfg(test)]
use personas_db::models::{PersonaTrustLevel, PersonaTrustOrigin};

// `pub(crate)` so sibling modules' tests can reuse the persona/tool fixtures
// (e.g. `prepared_run_cache`'s cache-key tests) instead of hand-rolling a
// 40-field `Persona` literal. Test-only either way (`cfg(test)`).
#[cfg(test)]
pub(crate) mod tests;

pub use assemble::*;
pub(crate) use discipline::*;
