//! The paired-devices roster. Absent entirely in a build with no device link,
//! because a roster of machines nothing can reach is worse than silence.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::indexes::{index_summary, BoundedBlock, CHARS_PER_TOKEN};
use crate::db::DbPool;

/// Token budget for the paired-devices block, independent of the index and
/// scene budgets.
const DEVICE_TOKEN_BUDGET: usize = 200;
/// Characters the block may occupy.
pub(super) const DEVICE_CHAR_BUDGET: usize = DEVICE_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Held back for the truncation footer. Same rule as everywhere else here: a
/// truncated roster that does not say it is truncated is worse than none.
const DEVICE_FOOTER_RESERVE: usize = 170;
/// Longest device name rendered before it is elided.
const DEVICE_NAME_CHARS: usize = 40;

const _: () = assert!(DEVICE_FOOTER_RESERVE < DEVICE_CHAR_BUDGET);

/// One paired device, reduced to what the prompt actually needs.
pub(super) struct PairedDeviceRow {
    pub(super) name: String,
    pub(super) is_home: bool,
    pub(super) reachable: bool,
}

/// The paired-device roster, with live reachability.
///
/// Both halves read the SYSTEM db and nothing else — `owned_devices` for the
/// roster, `discovered_peers.is_connected` for reachability, which the
/// connection manager maintains and resets to 0 on every boot. That keeps the
/// block a pair of cheap synchronous queries on a path that already holds the
/// pool, instead of an async hop into `NetworkService`.
#[cfg(feature = "p2p")]
fn paired_device_rows(sys_db: &DbPool) -> Vec<PairedDeviceRow> {
    let devices =
        crate::db::repos::resources::owned_devices::list_owned_devices(sys_db).unwrap_or_default();
    if devices.is_empty() {
        return Vec::new();
    }
    let connected: std::collections::HashSet<String> = sys_db
        .get()
        .ok()
        .and_then(|conn| {
            let mut stmt = conn
                .prepare("SELECT peer_id FROM discovered_peers WHERE is_connected = 1")
                .ok()?;
            let ids = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .ok()?
                .filter_map(Result::ok)
                .collect();
            Some(ids)
        })
        .unwrap_or_default();
    let mut rows: Vec<PairedDeviceRow> = devices
        .into_iter()
        .map(|d| PairedDeviceRow {
            reachable: connected.contains(&d.peer_id),
            is_home: d.is_home,
            name: d.display_name,
        })
        .collect();
    rows.sort_by(|a, b| b.is_home.cmp(&a.is_home).then_with(|| a.name.cmp(&b.name)));
    rows
}

/// A lite build (`--features desktop`) has no device link: `remote_instruct` is
/// still taught and still dispatched, but its transport half fails with an
/// honest sentence. A roster of machines nothing can reach would be worse than
/// silence, so the block is simply absent.
#[cfg(not(feature = "p2p"))]
fn paired_device_rows(_sys_db: &DbPool) -> Vec<PairedDeviceRow> {
    Vec::new()
}

/// The paired-devices block. Empty string when nothing is paired.
pub(super) fn format_paired_devices(sys_db: &DbPool) -> String {
    render_paired_devices(&paired_device_rows(sys_db))
}

/// Rendering half of [`format_paired_devices`], split out so the shape can be
/// asserted in BOTH feature sets without a DB or a network.
pub(super) fn render_paired_devices(devices: &[PairedDeviceRow]) -> String {
    let total = devices.len();
    // No header for an empty roster. A user who never paired anything should
    // pay nothing for the feature on every single turn.
    if total == 0 {
        return String::new();
    }
    let mut block = BoundedBlock::new(
        "\n\n# Paired devices (remote_instruct targets)\n\n\
         The user's OTHER Personas installs. Name one by the exact name shown; \
         never invent one. Omitting `device` means the home device, which is \
         the right default unless the work belongs on a specific machine. \
         `unreachable` means it is not on the network right now — say that \
         rather than proposing to send it work.\n\n",
        DEVICE_CHAR_BUDGET,
        DEVICE_FOOTER_RESERVE,
    );
    for d in devices {
        let line = format!(
            "- **{name}** — {home}{reach}\n",
            name = index_summary(&d.name, DEVICE_NAME_CHARS),
            home = if d.is_home { "home device · " } else { "" },
            reach = if d.reachable {
                "reachable"
            } else {
                "unreachable right now"
            },
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    if shown == total {
        return block.finish("");
    }
    block.finish(&format!(
        "\n_Listing {shown} of {total} paired devices, truncated for prompt \
         budget. Ask the user which machine he means rather than assuming the \
         rest are gone._\n"
    ))
}
