//! `athena-bench-validate` — deterministic backend for the Athena model/effort
//! bench (`scripts/test/athena-model-bench.mjs`; Track B of
//! `docs/plans/athena-live-conversation-layer.md`). Two modes:
//!
//! **Score a turn** (default):
//!   stdin:  one turn's raw assistant text (the concatenated CLI output the
//!           dispatcher would see in production).
//!   args:   `--pinned a,b,c` — connector names to seed as pinned+enabled.
//!   stdout: one JSON report from `bench::athena_validate::validate`.
//!
//! **Render a prompt** (`--render-prompt full|chat`):
//!   stdin:  the scenario's live-activity listing (may be empty).
//!   args:   `--pinned a,b,c`, `--voice`.
//!   stdout: the composed system prompt of that class, from the PRODUCTION
//!           composer, so the bench scores the family Athena actually gets.
//!   stderr: one line `prompt_chars=<n>` beside it.
//!
//! exit: 0 on a produced report/prompt (warnings included), 1 on harness error.

// This binary talks to a terminal, not to a log sink. Its output is either
// CLI UX (usage, results, install confirmation) or a diagnostic emitted before
// `tracing` is initialised — in both cases a `tracing` event would go nowhere a
// user could see. `print_stdout`/`print_stderr` are enabled workspace-wide to
// keep the *library* honest; the entry points are the deliberate exception.
#![allow(clippy::print_stdout, clippy::print_stderr)]

use std::io::Read as _;

use app_lib::bench::athena_prompt::{render_bench_prompt, BenchPromptContext, PromptClass};

fn main() {
    let mut pinned: Vec<String> = Vec::new();
    let mut render: Option<String> = None;
    let mut voice = false;
    let mut args = std::env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "--pinned" => {
                if let Some(list) = args.next() {
                    pinned.extend(
                        list.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(String::from),
                    );
                }
            }
            "--render-prompt" => render = args.next(),
            "--voice" => voice = true,
            other => {
                eprintln!("athena-bench-validate: unknown argument {other}");
                std::process::exit(1);
            }
        }
    }

    let mut text = String::new();
    if let Err(e) = std::io::stdin().read_to_string(&mut text) {
        eprintln!("athena-bench-validate: read stdin: {e}");
        std::process::exit(1);
    }

    if let Some(class) = render {
        let class = match class.as_str() {
            "full" => PromptClass::Full,
            "chat" => PromptClass::Chat,
            other => {
                eprintln!("athena-bench-validate: --render-prompt takes full|chat, got {other}");
                std::process::exit(1);
            }
        };
        let ctx = BenchPromptContext {
            pinned,
            activity: text,
            voice,
        };
        match render_bench_prompt(class, &ctx) {
            Ok((prompt, sizes)) => {
                eprintln!("prompt_chars={}", sizes.total());
                print!("{prompt}");
            }
            Err(e) => {
                eprintln!("athena-bench-validate: {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    match app_lib::bench::athena_validate::validate(&text, &pinned) {
        Ok(report) => println!("{report}"),
        Err(e) => {
            eprintln!("athena-bench-validate: {e}");
            std::process::exit(1);
        }
    }
}
