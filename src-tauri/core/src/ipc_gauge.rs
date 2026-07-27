//! Counter of in-flight IPC calls.
//!
//! Split out of `ipc_auth` in crate-split step 4b. `db` polls this to pick a
//! quiet moment for maintenance work (checkpointing, vacuum), and `ipc_auth`
//! lives above the data layer — so the *counter* moves down here while the
//! guard that increments it, and everything else about IPC authentication,
//! stays where it was.

use std::sync::atomic::{AtomicUsize, Ordering};

static IPC_IN_FLIGHT: AtomicUsize = AtomicUsize::new(0);

/// Number of IPC commands currently executing.
pub fn ipc_in_flight() -> usize {
    IPC_IN_FLIGHT.load(Ordering::Acquire)
}

/// Register the start of an IPC call. Pair with [`leave`] — prefer the RAII
/// guard in `ipc_auth` over calling these directly.
pub fn enter() {
    IPC_IN_FLIGHT.fetch_add(1, Ordering::AcqRel);
}

/// Register the end of an IPC call.
pub fn leave() {
    IPC_IN_FLIGHT.fetch_sub(1, Ordering::AcqRel);
}
