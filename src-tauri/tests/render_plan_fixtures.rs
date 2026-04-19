//! Golden-fixture snapshot tests for the RenderPlan compiler.
//!
//! Each `<fixture>.json` in `docs/concepts/render-plan-fixtures/v1/inputs/`
//! is compiled with the default preview options. The pretty-printed
//! `RenderPlan` JSON is diffed against the committed
//! `docs/concepts/render-plan-fixtures/v1/expected/<fixture>.json`.
//!
//! To regenerate expected outputs after an intentional compiler change:
//!
//!   UPDATE_RENDER_PLAN_FIXTURES=1 cargo test --features desktop --test render_plan_fixtures
//!
//! then manually inspect the diff in git and commit.

use std::fs;
use std::path::{Path, PathBuf};

use app_lib::render_plan::compile::{Composition, CompileDeps, CompileOptions};
use app_lib::render_plan::compile as render_plan_compile;

fn fixtures_dir() -> PathBuf {
    // tests/ runs from the src-tauri directory; fixtures live up one level.
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .join("docs/concepts/render-plan-fixtures/v1")
}

fn list_inputs(dir: &Path) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = fs::read_dir(dir.join("inputs"))
        .expect("inputs dir")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("json"))
        .collect();
    out.sort();
    out
}

fn compile_fixture(input_path: &Path) -> String {
    let raw = fs::read_to_string(input_path).expect("read fixture input");
    let comp: Composition =
        serde_json::from_str(&raw).expect("fixture input parses as Composition");
    let plan = render_plan_compile(
        &comp,
        &CompileOptions::for_export_default(),
        &CompileDeps::none(),
    )
    .expect("fixture compiles");
    let mut out = serde_json::to_string_pretty(&plan).expect("serialize plan");
    out.push('\n');
    out
}

#[test]
fn render_plan_fixtures_match() {
    let dir = fixtures_dir();
    let update = std::env::var("UPDATE_RENDER_PLAN_FIXTURES").is_ok();

    let inputs = list_inputs(&dir);
    assert!(!inputs.is_empty(), "no fixture inputs found at {:?}", dir);

    let mut failures: Vec<String> = Vec::new();

    for input_path in &inputs {
        let name = input_path.file_name().unwrap().to_string_lossy().into_owned();
        let expected_path = dir.join("expected").join(&name);
        let actual = compile_fixture(input_path);

        if update || !expected_path.exists() {
            fs::write(&expected_path, &actual).expect("write expected fixture");
            eprintln!("[fixtures] wrote {}", expected_path.display());
            continue;
        }

        let expected =
            fs::read_to_string(&expected_path).expect("read committed expected fixture");

        if actual != expected {
            failures.push(format!(
                "fixture {name} drift — run UPDATE_RENDER_PLAN_FIXTURES=1 to refresh if this is intentional"
            ));
        }
    }

    assert!(
        failures.is_empty(),
        "{} fixture(s) drifted:\n  {}",
        failures.len(),
        failures.join("\n  ")
    );
}
