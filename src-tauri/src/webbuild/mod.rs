//! Web-build runtime — the Bun-backed local project engine for the Athena
//! web-dev companion (scaffold-from-zero builds). **P0** of
//! `docs/plans/athena-webdev-companion-v0.md`.
//!
//! - [`bun`] — locate + invoke the Bun runtime sidecar.
//! - [`project`] — managed project directories under `~/.personas/projects/<slug>/`.
//! - [`devserver`] — supervised `bun run dev` servers (health, stop, and —
//!   critically — kill-on-exit so we never orphan a `bun`/`next` process tree).
//!
//! The runtime module + its own dev-server registry, wired into `AppState`,
//! the Tauri command surface (`commands::infrastructure::webbuild`), and the
//! app-exit hook (`stop_all`) so a closing app never orphans a dev server.

pub mod bun;
pub mod devserver;
pub mod plan;
pub mod project;

pub use devserver::{DevServerRegistry, DevServerStatus};
