//! Curator's plan, at the level it actually belongs.
//!
//! These modules were written inside `app_lib`'s command tree and never used a
//! line of Tauri: `instrument` spawns node through this crate's own subprocess
//! chokepoint, `projection` is a pure function, and `policy` reads settings out
//! of `personas-db`. The repo's rule is to put a module in the lowest crate whose
//! reach closes, and theirs closes here.
//!
//! Moving them is what lets `personas-curator-project` - the headless
//! re-projection binary - live in this crate and build without the Tauri
//! dependency tree. Before the move, the one step of Curator's loop that needed
//! no window still had to be compiled against one.
//!
//! `app_lib::commands::curator` re-exports all three, so every existing call site
//! resolves unchanged.

pub mod instrument;
pub mod policy;
pub mod projection;
