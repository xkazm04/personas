//! Unit tests for runtime prompt assembly, split out of the 2,071-line
//! `mod tests` block that used to close `prompt/mod.rs` — two thirds of that
//! file. One module per thing under test; the shared persona/tool/fix-loop
//! builders live in [`fixtures`].

mod assembly;
mod capabilities;
mod cli_args;
mod events;
mod fix_loop;
mod fixtures;
mod living_agent;
mod runtime_safety;

pub(crate) use fixtures::*;
