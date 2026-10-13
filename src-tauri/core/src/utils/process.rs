//! Spawning a child process without a console window on the operator's desktop.
//!
//! A console program started from a GUI process (or from one with no console at all) gets a
//! NEW, visible console window unless `CREATE_NO_WINDOW` is passed. Every spawn site in this
//! workspace that forgot it flashed a conhost, and more than twenty sites each declared the
//! flag themselves (`0x0800_0000`, or `0x08000000`, with or without a named const).
//! Measured 2026-10-13 from the other side: a detached driver with no console made every
//! child it started open a visible window - the operator saw a stream of them all afternoon.
//!
//! `no_window()` sets ONLY `CREATE_NO_WINDOW`, replacing any flags set before it: Windows'
//! `creation_flags` is a setter, not an `|=`. A site that needs another flag as well
//! (`CREATE_NEW_PROCESS_GROUP`, `DETACHED_PROCESS`) composes them itself with
//! [`CREATE_NO_WINDOW`] - this helper is for the common case, not for every case.

/// `CREATE_NO_WINDOW`: the child gets a console that has no window, inherited by its own
/// children, so nothing below it opens one either.
pub const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Start this command without a console window on Windows; a no-op elsewhere.
pub trait NoWindow {
    fn no_window(&mut self) -> &mut Self;
}

impl NoWindow for std::process::Command {
    fn no_window(&mut self) -> &mut Self {
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            self.creation_flags(CREATE_NO_WINDOW);
        }
        self
    }
}

impl NoWindow for tokio::process::Command {
    fn no_window(&mut self) -> &mut Self {
        // An inherent method on tokio's Command - no CommandExt import.
        #[cfg(windows)]
        self.creation_flags(CREATE_NO_WINDOW);
        self
    }
}

// No unit test spawns a process here: the census counts every `Command::new` outside the
// subprocess chokepoint, tests included, and this helper is exercised by its five call sites
// (connector_readiness, drive reveal, devserver kill_tree/pid_is_node, bun). The flag value is
// the one thing a test can pin without a spawn.
#[cfg(test)]
mod tests {
    #[test]
    fn the_flag_is_windows_create_no_window() {
        assert_eq!(super::CREATE_NO_WINDOW, 0x0800_0000);
    }
}
