//! The paired-devices roster. Absent entirely in a build with no device link,
//! because a roster of machines nothing can reach is worse than silence.
//!
//! Since the device mesh (spark device-mesh, wave 3 #11) each row also carries
//! what that device last reported about itself: its CPU / RAM / GPU share,
//! running and queued counts, and the axes its agents mostly consume. That is
//! what lets Athena pick the machine with room for `mesh_queue_move` and see
//! which agents `mesh_set_agent_enabled` would be switching. A report older
//! than the mesh's stale window reads `load unknown`, never as numbers.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::indexes::{index_summary, BoundedBlock, CHARS_PER_TOKEN};
use crate::db::models::ResourceAxis;
use crate::db::DbPool;

/// Token budget for the paired-devices block, independent of the index and
/// scene budgets.
///
/// 200 -> 360 (2026-10-13, device mesh): a row grew from ~45 characters (name,
/// home, reachability) to ~140 with the load line, and the header gained one
/// sentence. 360 tokens keep the same ~6 devices visible before the truncation
/// footer that 200 did; the block still costs nothing when nothing is paired.
const DEVICE_TOKEN_BUDGET: usize = 360;
/// Characters the block may occupy.
pub(super) const DEVICE_CHAR_BUDGET: usize = DEVICE_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Held back for the truncation footer. Same rule as everywhere else here: a
/// truncated roster that does not say it is truncated is worse than none.
const DEVICE_FOOTER_RESERVE: usize = 170;
/// Longest device name rendered before it is elided.
const DEVICE_NAME_CHARS: usize = 40;
/// How many dominant axes of a device's agents are named.
const TOP_AXES: usize = 2;

const _: () = assert!(DEVICE_FOOTER_RESERVE < DEVICE_CHAR_BUDGET);

/// One paired device, reduced to what the prompt actually needs.
#[derive(Debug, Clone)]
pub(super) struct PairedDeviceRow {
    pub(super) name: String,
    pub(super) is_home: bool,
    pub(super) reachable: bool,
}

/// What a paired device last reported about its load, as the prompt reads it.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum DeviceLoad {
    /// No report yet, or the last one is older than the stale window.
    Unknown,
    Live(LiveLoad),
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct LiveLoad {
    pub(super) cpu: f64,
    pub(super) ram: f64,
    /// `None` = that device cannot read GPU engines (absent, not 0).
    pub(super) gpu: Option<f64>,
    pub(super) running: u32,
    pub(super) queued: u32,
    /// The commonest dominant axes of its agents, most common first.
    pub(super) top_axes: Vec<(ResourceAxis, usize)>,
}

impl LiveLoad {
    /// Reduce a device snapshot to the prompt's view of it.
    pub(super) fn from_snapshot(s: &crate::db::models::DeviceSnapshot) -> Self {
        let mut counts: Vec<(ResourceAxis, usize)> = Vec::new();
        for axis in s.agents.iter().filter_map(|a| a.dominant) {
            match counts.iter_mut().find(|(a, _)| *a == axis) {
                Some((_, n)) => *n += 1,
                None => counts.push((axis, 1)),
            }
        }
        // Most common first; a tie keeps cpu, ram, gpu order (stable sort over
        // first appearance would depend on agent order, which is not meaning).
        counts.sort_by(|(a, n), (b, m)| m.cmp(n).then_with(|| axis_rank(*a).cmp(&axis_rank(*b))));
        counts.truncate(TOP_AXES);
        Self {
            cpu: s.host.cpu_share,
            ram: s.host.ram_share,
            gpu: s.host.gpu_share,
            running: s.running,
            queued: s.queued,
            top_axes: counts,
        }
    }
}

fn axis_rank(a: ResourceAxis) -> u8 {
    match a {
        ResourceAxis::Cpu => 0,
        ResourceAxis::Ram => 1,
        ResourceAxis::Gpu => 2,
    }
}

/// A share in `0..=1` as a whole percent. Clamped: a share is never shown
/// above 100 or below 0 whatever a peer claims.
fn pct(share: f64) -> u32 {
    (share.clamp(0.0, 1.0) * 100.0).round() as u32
}

/// One roster row plus its load, `None` when there is no mesh to ask (the
/// row then renders exactly as it did before the mesh existed).
pub(super) struct MeshDeviceRow {
    pub(super) row: PairedDeviceRow,
    pub(super) load: Option<DeviceLoad>,
}

/// The paired-device roster, with live reachability and each device's last
/// reported load.
///
/// The roster and reachability read the SYSTEM db — `owned_devices`, and
/// `discovered_peers.is_connected`, which the connection manager maintains
/// and resets to 0 on every boot. The load reads the mesh's in-memory
/// snapshot cache (`crate::mesh::installed_mesh`), a lock and a clone: no
/// async hop into `NetworkService` on the prompt path.
#[cfg(feature = "p2p")]
fn mesh_device_rows(sys_db: &DbPool) -> Vec<MeshDeviceRow> {
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
    let mesh = crate::mesh::installed_mesh();
    let now = crate::engine::p2p::mesh::now_ms();
    let mut rows: Vec<MeshDeviceRow> = devices
        .into_iter()
        .map(|d| {
            let load = mesh.as_ref().map(|m| match m.cached(&d.peer_id, now) {
                (Some(snapshot), _, crate::db::models::MeshLiveness::Live) => {
                    DeviceLoad::Live(LiveLoad::from_snapshot(&snapshot))
                }
                _ => DeviceLoad::Unknown,
            });
            MeshDeviceRow {
                row: PairedDeviceRow {
                    reachable: connected.contains(&d.peer_id),
                    is_home: d.is_home,
                    name: d.display_name,
                },
                load,
            }
        })
        .collect();
    rows.sort_by(|a, b| {
        b.row
            .is_home
            .cmp(&a.row.is_home)
            .then_with(|| a.row.name.cmp(&b.row.name))
    });
    rows
}

/// A lite build without `p2p` has no device link: `remote_instruct` is still
/// taught and still dispatched, but its transport half fails with an honest
/// sentence. A roster of machines nothing can reach would be worse than
/// silence, so the block is simply absent.
#[cfg(not(feature = "p2p"))]
fn mesh_device_rows(_sys_db: &DbPool) -> Vec<MeshDeviceRow> {
    Vec::new()
}

/// The paired-devices block. Empty string when nothing is paired.
pub(super) fn format_paired_devices(sys_db: &DbPool) -> String {
    render_mesh_devices(&mesh_device_rows(sys_db))
}

/// Rendering half for rows without load (the pre-mesh shape), kept so the
/// roster's own rules are asserted without a mesh.
#[cfg(test)]
pub(super) fn render_paired_devices(devices: &[PairedDeviceRow]) -> String {
    let rows: Vec<MeshDeviceRow> = devices
        .iter()
        .map(|row| MeshDeviceRow {
            row: row.clone(),
            load: None,
        })
        .collect();
    render_mesh_devices(&rows)
}

/// The load half of one row: ` · load ...`, or nothing when there is no mesh.
fn load_suffix(load: Option<&DeviceLoad>) -> String {
    match load {
        None => String::new(),
        Some(DeviceLoad::Unknown) => " · load unknown".to_string(),
        Some(DeviceLoad::Live(l)) => {
            let gpu = l
                .gpu
                .map(|g| format!(" gpu {}%", pct(g)))
                .unwrap_or_default();
            let axes = if l.top_axes.is_empty() {
                String::new()
            } else {
                format!(
                    " · agents mostly {}",
                    l.top_axes
                        .iter()
                        .map(|(a, n)| format!("{} ({n})", a.as_str()))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            };
            format!(
                " · load cpu {}% ram {}%{gpu} · {} running, {} queued{axes}",
                pct(l.cpu),
                pct(l.ram),
                l.running,
                l.queued
            )
        }
    }
}

/// Rendering half of [`format_paired_devices`], split out so the shape can be
/// asserted in BOTH feature sets without a DB or a network.
pub(super) fn render_mesh_devices(devices: &[MeshDeviceRow]) -> String {
    let total = devices.len();
    // No header for an empty roster. A user who never paired anything should
    // pay nothing for the feature on every single turn.
    if total == 0 {
        return String::new();
    }
    let mut block = BoundedBlock::new(
        "\n\n# Paired devices (remote_instruct / remote_fleet_dispatch / mesh_* targets)\n\n\
         The user's OTHER Personas installs. Name one by the exact name shown; \
         never invent one. Omitting `device` means the home device, which is \
         the right default unless the work belongs on a specific machine. \
         `unreachable` means it is not on the network right now: work sent \
         there is queued until it wakes, so say that rather than \"sent\". \
         `load` is that device's own last report (CPU / RAM / GPU share); \
         `load unknown` means no fresh report, so do not guess.\n\n",
        DEVICE_CHAR_BUDGET,
        DEVICE_FOOTER_RESERVE,
    );
    for d in devices {
        let line = format!(
            "- **{name}** — {home}{reach}{load}\n",
            name = index_summary(&d.row.name, DEVICE_NAME_CHARS),
            home = if d.row.is_home { "home device · " } else { "" },
            reach = if d.row.reachable {
                "reachable"
            } else {
                "unreachable right now"
            },
            load = load_suffix(d.load.as_ref()),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::models::{DeviceAgent, DeviceHostLoad, DeviceSnapshot};

    fn snapshot(gpu: Option<f64>, axes: &[Option<ResourceAxis>]) -> DeviceSnapshot {
        DeviceSnapshot {
            peer_id: "peer-desk".into(),
            display_name: "Desk".into(),
            app_version: "0.42.0".into(),
            sent_at_ms: 1.0,
            host: DeviceHostLoad {
                cpu_share: 0.12,
                ram_share: 0.41,
                gpu_share: gpu,
            },
            running: 1,
            queued: 2,
            agents: axes
                .iter()
                .enumerate()
                .map(|(i, dominant)| DeviceAgent {
                    persona_id: format!("p-{i}"),
                    name: format!("Agent {i}"),
                    enabled: true,
                    project_id: None,
                    project_enabled: None,
                    dominant: *dominant,
                    running: false,
                })
                .collect(),
            queue: Vec::new(),
        }
    }

    fn row(name: &str, is_home: bool, reachable: bool, load: Option<DeviceLoad>) -> MeshDeviceRow {
        MeshDeviceRow {
            row: PairedDeviceRow {
                name: name.into(),
                is_home,
                reachable,
            },
            load,
        }
    }

    #[test]
    fn a_live_device_renders_its_load_counts_and_top_axes() {
        use ResourceAxis::*;
        let live = LiveLoad::from_snapshot(&snapshot(
            Some(0.031),
            &[
                Some(Ram),
                Some(Cpu),
                Some(Cpu),
                None,
                Some(Gpu),
                Some(Cpu),
                Some(Ram),
            ],
        ));
        assert_eq!(live.top_axes, vec![(Cpu, 3), (Ram, 2)], "top two, by count");
        let block = render_mesh_devices(&[row("Desk", true, true, Some(DeviceLoad::Live(live)))]);
        assert!(
            block.contains(
                "- **Desk** — home device · reachable · load cpu 12% ram 41% gpu 3% · 1 running, 2 queued · agents mostly cpu (3), ram (2)\n"
            ),
            "{block}"
        );
    }

    #[test]
    fn an_unknown_gpu_is_absent_not_zero_and_no_measured_agents_says_nothing() {
        let live = LiveLoad::from_snapshot(&snapshot(None, &[None, None]));
        let block = render_mesh_devices(&[row("Air", false, true, Some(DeviceLoad::Live(live)))]);
        assert!(
            block.contains("- **Air** — reachable · load cpu 12% ram 41% · 1 running, 2 queued\n"),
            "{block}"
        );
        assert!(!block.contains("gpu 0%"), "{block}");
    }

    #[test]
    fn a_stale_report_is_load_unknown_and_no_mesh_is_the_old_row() {
        let block = render_mesh_devices(&[
            row("Desk", true, true, None),
            row("Laptop", false, false, Some(DeviceLoad::Unknown)),
        ]);
        assert!(
            block.contains("- **Desk** — home device · reachable\n"),
            "{block}"
        );
        assert!(
            block.contains("- **Laptop** — unreachable right now · load unknown\n"),
            "{block}"
        );
        assert!(
            block.contains("`load unknown` means no fresh report"),
            "{block}"
        );
    }

    #[test]
    fn a_peer_cannot_claim_more_than_the_whole_machine() {
        assert_eq!(pct(1.7), 100);
        assert_eq!(pct(-0.2), 0);
        assert_eq!(pct(0.005), 1);
    }

    #[test]
    fn a_full_roster_of_live_devices_stays_inside_the_budget() {
        let many: Vec<MeshDeviceRow> = (0..30)
            .map(|i| {
                let live = LiveLoad::from_snapshot(&snapshot(
                    Some(0.5),
                    &[Some(ResourceAxis::Cpu), Some(ResourceAxis::Ram)],
                ));
                row(
                    &format!("Device number {i:02}"),
                    i == 0,
                    true,
                    Some(DeviceLoad::Live(live)),
                )
            })
            .collect();
        let block = render_mesh_devices(&many);
        assert!(block.len() <= DEVICE_CHAR_BUDGET, "{} chars", block.len());
        assert!(block.contains("of 30 paired devices"), "{block}");
        // The budget still shows a useful handful of live rows.
        assert!(block.matches("· load cpu").count() >= 5, "{block}");
    }
}
