//! **One-box two-node mesh — DEV ONLY. SECURITY-SENSITIVE: human review.**
//!
//! Two isolated Personas instances on ONE machine (spark device-mesh, wave-3
//! decision 10) need three things a single install never does:
//!
//! 1. their own QUIC port ([`p2p_port_override`]: `PERSONAS_P2P_PORT`);
//! 2. their own identity key in the OS keyring
//!    (`identity::keyring_entry_name`: the entry is scoped by a hash of the
//!    data dir, because the keyring is per USER, not per data dir, and two
//!    instances sharing one entry would sign as the same device while their
//!    databases disagree about who that is);
//! 3. a way to dial each other by address ([`super::NetworkService::connect_to_address`]).
//!
//! **Every one of these is OFF unless `PERSONAS_DATA_DIR` is set** to a
//! non-blank value - the same rule `boot::paths::resolve_app_data_dir` uses
//! to decide that the instance is an isolated test instance. Without it, the
//! port is the configured one, the keyring entry is the historical
//! `ed25519-identity-key`, and an address dial is refused: byte-identical to
//! the behaviour before this module existed (tests assert both halves).
//!
//! The pure halves take their inputs as arguments so the tests never mutate
//! the process environment.

use std::path::PathBuf;

/// The environment variable that marks an isolated (test) instance. Read
/// here, never written.
pub const DATA_DIR_ENV: &str = "PERSONAS_DATA_DIR";
/// The QUIC port override, honoured ONLY beside [`DATA_DIR_ENV`].
pub const P2P_PORT_ENV: &str = "PERSONAS_P2P_PORT";

/// The isolated data dir, canonicalized, or `None` for a normal install.
///
/// "Set" means non-blank after trimming, exactly as boot reads it. The path
/// is canonicalized so `C:\x\..\y` and `C:\y` name one instance; a path that
/// cannot be canonicalized (boot creates the dir before anything reads this,
/// so that is unexpected) falls back to the trimmed text, which still keeps
/// the instance isolated, just keyed by the text as given.
pub fn isolated_data_dir() -> Option<PathBuf> {
    isolated_data_dir_from(std::env::var(DATA_DIR_ENV).ok().as_deref())
}

/// [`isolated_data_dir`] over an explicit value (the testable half).
pub fn isolated_data_dir_from(raw: Option<&str>) -> Option<PathBuf> {
    let trimmed = raw.map(str::trim).filter(|s| !s.is_empty())?;
    let path = PathBuf::from(trimmed);
    Some(std::fs::canonicalize(&path).unwrap_or(path))
}

/// Whether this instance is an isolated (test) instance.
pub fn is_isolated() -> bool {
    isolated_data_dir().is_some()
}

/// The QUIC port override, or `None` (use the configured port).
pub fn p2p_port_override() -> Option<u16> {
    p2p_port_override_from(
        std::env::var(DATA_DIR_ENV).ok().as_deref(),
        std::env::var(P2P_PORT_ENV).ok().as_deref(),
    )
}

/// [`p2p_port_override`] over explicit values. `PERSONAS_P2P_PORT` alone is
/// ignored; a value that is not a port in `1..=65535` is ignored too (logged
/// by the caller's start-up line, never a panic).
pub fn p2p_port_override_from(data_dir: Option<&str>, port: Option<&str>) -> Option<u16> {
    data_dir.map(str::trim).filter(|s| !s.is_empty())?;
    port.and_then(|p| p.trim().parse::<u16>().ok())
        .filter(|p| *p != 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_isolated_without_a_data_dir() {
        assert_eq!(isolated_data_dir_from(None), None);
        assert_eq!(isolated_data_dir_from(Some("")), None);
        assert_eq!(isolated_data_dir_from(Some("   ")), None);
    }

    #[test]
    fn the_port_override_needs_the_data_dir() {
        assert_eq!(p2p_port_override_from(None, Some("4300")), None);
        assert_eq!(p2p_port_override_from(Some(" "), Some("4300")), None);
        assert_eq!(p2p_port_override_from(Some("C:/tmp/a"), None), None);
        assert_eq!(
            p2p_port_override_from(Some("C:/tmp/a"), Some("4300")),
            Some(4300)
        );
        assert_eq!(
            p2p_port_override_from(Some("C:/tmp/a"), Some(" 4301 ")),
            Some(4301)
        );
        assert_eq!(p2p_port_override_from(Some("C:/tmp/a"), Some("0")), None);
        assert_eq!(
            p2p_port_override_from(Some("C:/tmp/a"), Some("70000")),
            None
        );
        assert_eq!(p2p_port_override_from(Some("C:/tmp/a"), Some("abc")), None);
    }

    #[test]
    fn an_existing_dir_is_canonicalized() {
        let dir = std::env::temp_dir();
        let via_dots = dir
            .join("..")
            .join(dir.file_name().expect("temp dir has a name"));
        assert_eq!(
            isolated_data_dir_from(via_dots.to_str()),
            isolated_data_dir_from(dir.to_str()),
            "two spellings of one dir are one instance"
        );
    }
}
