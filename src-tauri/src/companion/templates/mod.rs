//! Embedded companion-brain templates copied to disk on first run.

/// Athena's static constitution — character, voice, provenance contract.
/// Rarely changes. When it does, bump `CONSTITUTION_VERSION`.
pub const CONSTITUTION_MD: &str = include_str!("constitution.md");

/// Identity scaffold seeded on first run. Onboarding fills in placeholders;
/// reflection cycles update sections over time. User may edit at any time.
pub const IDENTITY_MD_TEMPLATE: &str = include_str!("identity.md");

/// Bumped when CONSTITUTION_MD changes in a way that affects behavior.
/// Persisted with each session so cross-version behavior is auditable.
pub const CONSTITUTION_VERSION: u32 = 1;
