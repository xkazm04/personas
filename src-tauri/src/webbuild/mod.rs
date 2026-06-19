//! Web-build runtime — the Bun-backed local project engine for the Athena
//! web-dev companion (scaffold-from-zero builds). **P0** of
//! `docs/plans/athena-webdev-companion-v0.md`.
//!
//! - [`bun`] — locate + invoke the Bun runtime sidecar.
//! - [`project`] — managed project directories under `~/.personas/projects/<slug>/`.
//! - [`devserver`] — supervised `bun run dev` servers (health, stop, and —
//!   critically — kill-on-exit so we never orphan a `bun`/`next` process tree).
//!
//! P0 increment 1 is this runtime module + its own dev-server registry. It is
//! wired into `AppState` + the Tauri command surface + the window-close exit
//! hook in the next increment; until then its public API is unused from the
//! crate, so dead-code is silenced here (a temporary, not a permanent, allow).
#![allow(dead_code)]

pub mod bun;
pub mod devserver;
pub mod project;

pub use devserver::{DevServerRegistry, DevServerStatus};
