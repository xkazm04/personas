//! The scene digest — the published canvas, bounded to its own token budget.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use super::indexes::{index_summary, BoundedBlock, CHARS_PER_TOKEN};
use crate::db::DbPool;

/// Token budget for the scene digest, independent of [`INDEX_TOKEN_BUDGET`].
const SCENE_TOKEN_BUDGET: usize = 1200;
/// Characters the digest may occupy.
pub(super) const SCENE_CHAR_BUDGET: usize = SCENE_TOKEN_BUDGET * CHARS_PER_TOKEN;
/// Held back for the footer, which carries the true project count and the
/// data-family caveats. Generous on purpose: same rule as the index blocks,
/// a truncated triage list that does not SAY it is truncated is worse than none.
const SCENE_FOOTER_RESERVE: usize = 420;
/// Unhealthy cells named per project row. Beyond this the row says how many
/// more there are rather than spending the whole budget on one bad project.
const SCENE_CELLS_PER_ROW: usize = 6;

const _: () = assert!(SCENE_FOOTER_RESERVE < SCENE_CHAR_BUDGET);

/// The Mastermind canvas, worst-first. See the block comment above.
pub(super) fn format_scene_digest(sys_db: &DbPool) -> String {
    let Some(scene) = crate::companion::canvas::load_scene(sys_db) else {
        return String::new();
    };
    render_scene_digest(&scene)
}

/// Rendering half of [`format_scene_digest`], split out so the budget can be
/// tested against a synthetic 50-project scene without touching the DB.
pub(super) fn render_scene_digest(scene: &crate::companion::canvas::CanvasScene) -> String {
    let triaged = scene.triaged();
    let total = triaged.len();
    let caveats = crate::companion::canvas::scene_caveats(scene);
    if total == 0 {
        return format!(
            "\n\n# Mastermind canvas\n\nThe canvas has no projects on it. _{caveats}._\n"
        );
    }
    let mut block = BoundedBlock::new(
        "\n\n# Mastermind canvas (worst first)\n\n\
         The user's project portfolio as the canvas derived it, ordered by what \
         needs attention: live blocked sessions first, then island state, then \
         alerting cells, then blockers. Only cells that are NOT fine are listed. \
         Reference a project by the exact slug shown; never invent one.\n\n",
        SCENE_CHAR_BUDGET,
        SCENE_FOOTER_RESERVE,
    );
    for p in &triaged {
        let unhealthy = p.unhealthy_cells();
        let named: Vec<String> = unhealthy
            .iter()
            .take(SCENE_CELLS_PER_ROW)
            .map(|c| index_summary(c, 46))
            .collect();
        let more = unhealthy.len().saturating_sub(named.len());
        let cells = if named.is_empty() {
            "all cells fine".to_string()
        } else {
            format!(
                "{}{}",
                named.join(", "),
                if more > 0 {
                    format!(", +{more} more")
                } else {
                    String::new()
                }
            )
        };
        let line = format!(
            "- **{name}** `{slug}` · {state}{attention}{blockers}{fleet} · {cells}\n",
            name = index_summary(&p.name, 40),
            slug = p.slug,
            state = p.state,
            attention = if p.attention { " · NEEDS YOU" } else { "" },
            blockers = if p.blockers > 0 {
                format!(" · {} blockers", p.blockers)
            } else {
                String::new()
            },
            fleet = if p.fleet > 0 {
                format!(" · {} live sessions", p.fleet)
            } else {
                String::new()
            },
            cells = cells,
        );
        if !block.push_row(&line) {
            break;
        }
    }
    let shown = block.shown;
    block.finish(&format!(
        "\n_Listing {shown} of {total} projects, worst first, truncated for \
         prompt budget. {caveats}._ Use the `describe_canvas_project` read op \
         for one island's full fifteen cells, and `describe_canvas_freshness` \
         for scan ages, ongoing goals and KPI standing. To act: \
         `canvas_dispatch` (one project), `canvas_group_dispatch` (several, run \
         one after another), `canvas_run_idea_scan`. To show structured \
         findings about one project, `compose_canvas_panel` docks a \
         SurfaceSpec v1 panel beside its island.\n"
    ))
}

// ─────────────────────────────────────────────────────────────────────────
// Paired devices — the "which other machines can I hand work to" block
//
// `remote_instruct` (WP3) sends an instruction to another of the user's own
// Personas installs. Until this block existed Athena had no roster: she could
// only echo a name the operator had just said out loud, and she could not tell
// a sleeping laptop from a live one until the send failed. Both are answered
// by three facts per device — name, home, reachable — and nothing else. A
// paired device has no other property worth a token on every turn.
//
// Budget: its OWN ~200 tokens. It is a handful of short rows; carving it out
// of `INDEX_CHAR_BUDGET` would make a device roster compete with the persona
// index for room, which is not a trade anyone would choose deliberately.
//
// Ordering is home-first then alphabetical, NOT recency: this block ships on
// every turn, and a list that reshuffles between turns invalidates the prompt
// cache for no informational gain. Reachability does churn — that is the point
// of it — but it churns only when the network actually changed.
// ─────────────────────────────────────────────────────────────────────────
