//! `athena-bench-validate` — deterministic scorer backend for the Athena
//! model/effort bench (`scripts/test/athena-model-bench.mjs`; Track B of
//! `docs/plans/athena-live-conversation-layer.md`).
//!
//! stdin:  one turn's raw assistant text (the concatenated CLI output the
//!         dispatcher would see in production).
//! args:   `--pinned a,b,c` — connector names to seed as pinned+enabled.
//! stdout: one JSON report from `bench::athena_validate::validate`.
//! exit:   0 on a produced report (warnings included), 1 on harness error.

use std::io::Read as _;

fn main() {
    let mut pinned: Vec<String> = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        if a == "--pinned" {
            if let Some(list) = args.next() {
                pinned.extend(
                    list.split(',')
                        .map(str::trim)
                        .filter(|s| !s.is_empty())
                        .map(String::from),
                );
            }
        }
    }

    let mut text = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut text) {
        eprintln!("athena-bench-validate: read stdin: {e}");
        std::process::exit(1);
    }

    match app_lib::bench::athena_validate::validate(&text, &pinned) {
        Ok(report) => println!("{report}"),
        Err(e) => {
            eprintln!("athena-bench-validate: {e}");
            std::process::exit(1);
        }
    }
}
