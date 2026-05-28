//! Regenerate the eval/certification TypeScript bindings.
//!
//! Run with:
//!   cargo test --features desktop --test eval_runs_bindings_gen
//!
//! Mirrors `render_plan_bindings_gen.rs`: an escape hatch that calls
//! `TS::export_all()` from the root types so the bindings land in
//! `src/lib/bindings/` (the canonical `TS_RS_EXPORT_DIR`) regardless of the
//! `--lib` test target's health. `export_all()` walks the type graph, so the
//! three roots transitively cover every nested struct.

use app_lib::eval_runs::{EvalRunDetail, EvalRunSummary, TeamCertStatus, TrajectoryPoint};
use ts_rs::TS;

#[test]
fn export_eval_runs_bindings() {
    EvalRunSummary::export_all().expect("export EvalRunSummary");
    EvalRunDetail::export_all().expect("export EvalRunDetail");
    TeamCertStatus::export_all().expect("export TeamCertStatus");
    TrajectoryPoint::export_all().expect("export TrajectoryPoint");
}
