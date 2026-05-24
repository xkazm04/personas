pub mod chat;
pub mod data_portability;
pub mod export_types;
pub mod import_export;
pub mod memories;
pub mod memory_compile;
/// Custom persona icon upload/storage. Gated on `desktop` because the image
/// decode/re-encode pipeline depends on the `image` crate (a `desktop` dep).
#[cfg(feature = "desktop")]
pub mod persona_icons;
/// AI generation of custom persona icons via a vault image-gen connector.
/// Gated on `desktop` — depends on `persona_icons::store_icon_bytes`.
#[cfg(feature = "desktop")]
pub mod persona_icon_gen;
pub mod persona_jobs;
pub mod personas;
pub mod saved_views;
pub mod use_cases;
pub mod validation;
