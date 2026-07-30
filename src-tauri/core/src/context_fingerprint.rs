//! Deterministic per-context structural fingerprint — cheap FACTS, no LLM.
//!
//! **Why this exists.** The app scans a lot: context maps, skills coverage,
//! engineering-pattern compliance. Every scan used to re-read files to answer
//! ONE question and then throw the reading away. A probe over the real repo read
//! **13,622 files to answer 6 questions**, because the only narrowing metadata
//! available was `dev_contexts.category` — a 4-valued field (ui/lib/api/data).
//! All 236 context `description` fields are the literal placeholder "Pending LLM
//! description", and `businessFeature`/`target`/`apiRoutes` are empty, so there
//! is no semantic layer to route on.
//!
//! The fix is to extract cheap deterministic facts per context **once**, cache
//! them keyed by content hash (`dev_context_fingerprints`), and let future
//! questions be SQL queries instead of file reads. The scan becomes an
//! investment rather than an expense.
//!
//! **This module is pure.** No filesystem, no network, no LLM, no Tauri. The
//! caller reads files and passes `(relative_path, contents)` in, which makes the
//! whole thing trivially testable — and it lives in `personas-core` because
//! this crate's test binary actually executes on the Windows-on-ARM dev host
//! while `app_lib`'s cannot (`STATUS_ENTRYPOINT_NOT_FOUND`).
//!
//! **These are facts, not verdicts.** Every counter is a coarse textual signal
//! chosen because it is cheap and stable, not because it proves anything. The
//! most obviously coarse one, `set_state_after_await_count`, is called out
//! explicitly below. Consumers should use a fingerprint to decide *which files
//! are worth reading*, never to conclude that a context is correct or broken.
//!
//! Detection targets were derived from what six real audited techniques needed,
//! not invented.

/// A third-party / framework dependency worth reporting when a context actually
/// imports it.
struct Dep {
    /// Name reported in the `imports` JSON array.
    name: &'static str,
    /// JS/TS module specifier, matched against the quoted specifier of an
    /// `import … from '<x>'` / `require('<x>')` (exact, or a `<x>/subpath`).
    ts: Option<&'static str>,
    /// Rust path prefix INCLUDING the `::`, matched at an identifier boundary so
    /// `my_tokio::` does not count as `tokio::`.
    rust: Option<&'static str>,
}

/// Fixed order → deterministic `imports` output.
const DEPS: &[Dep] = &[
    Dep { name: "react", ts: Some("react"), rust: None },
    Dep { name: "zustand", ts: Some("zustand"), rust: None },
    Dep { name: "framer-motion", ts: Some("framer-motion"), rust: None },
    Dep { name: "rusqlite", ts: None, rust: Some("rusqlite::") },
    Dep { name: "reqwest", ts: None, rust: Some("reqwest::") },
    Dep { name: "tokio", ts: None, rust: Some("tokio::") },
    Dep { name: "serde", ts: None, rust: Some("serde::") },
    Dep { name: "ts-rs", ts: None, rust: Some("ts_rs::") },
    // Cheap extensions beyond the original six-technique list: `tauri::` is the
    // load-bearing IPC marker for this repo, and `sha2::`/`chrono::` separate
    // hashing/time-handling contexts from the rest of the Rust surface.
    Dep { name: "tauri", ts: None, rust: Some("tauri::") },
    Dep { name: "sha2", ts: None, rust: Some("sha2::") },
    Dep { name: "chrono", ts: None, rust: Some("chrono::") },
];

/// In-repo primitives, matched as exact identifier substrings. Presence of one
/// of these says "this context already uses the house pattern"; absence is the
/// signal that routes a compliance question to the files.
const PRIMITIVES: &[&str] = &[
    "createLatestWins",
    "mapWithConcurrency",
    "build_ssrf_safe_client",
    "invokeWithTimeout",
    "toastCatch",
    "silentCatch",
    "SecureString",
    "init_test_db",
];

/// Lines this many past an `await` / `.then(` still count as "after the await"
/// for `set_state_after_await_count`.
const AWAIT_WINDOW_LINES: usize = 4;

/// The deterministic facts extracted from one context's files.
///
/// Deliberately carries no `file_count` / `missing_file_count`: those are
/// caller-side facts about the context's *mapping* (how many paths it declares,
/// how many of them no longer exist on disk), not about the contents handed to
/// [`fingerprint_files`].
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Fingerprint {
    /// Detected third-party/framework deps, in `DEPS` order.
    pub imports: Vec<String>,
    /// Detected in-repo primitives, in `PRIMITIVES` order.
    pub primitives: Vec<String>,
    /// `Promise.all(` occurrences.
    pub promise_all_count: i32,
    /// `join_all(` occurrences — includes `try_join_all(`, which ends in the
    /// same needle, so this is the union of both forms.
    pub join_all_count: i32,
    /// `await` as a whole word: covers both TS `await foo()` and Rust `.await`.
    pub await_count: i32,
    /// `INSERT `/`UPDATE `/`DELETE ` appearing on a line that also contains a
    /// quote character (a cheap "inside a string literal" proxy). Comment lines
    /// are skipped, because these are ordinary English words in prose.
    pub sql_write_count: i32,
    /// `tokio::spawn` + `spawn_blocking` + `async_runtime::spawn`.
    pub spawn_count: i32,
    /// `useEffect(` occurrences.
    pub use_effect_count: i32,
    /// **A PROXY, NOT A VERDICT.** Counts async sites (`await` / `.then(`) that
    /// are followed within [`AWAIT_WINDOW_LINES`] lines by a `setFoo(` or
    /// `.store(` call — the coarse textual shape of a stale write after an
    /// suspension point. It cannot see whether the setter is guarded, whether
    /// the component is still mounted, or whether the value is even derived from
    /// the awaited result. A non-zero count means "worth reading", nothing more.
    /// At most one is counted per async site so one hot function cannot dominate.
    pub set_state_after_await_count: i32,
    /// A `.tsx` file exports a component (default export, or an exported
    /// capitalized symbol).
    pub exports_components: bool,
    /// `export function use…` / `export const use…` (capitalized suffix).
    pub exports_hooks: bool,
    /// `#[tauri::command]` present.
    pub exports_commands: bool,
    /// `pub fn` inside a `repos/` path.
    pub exports_repo_fns: bool,
}

/// Fingerprint a context from its files, given as `(relative_path, contents)`.
///
/// Pure and deterministic: the same input always yields the same output, and the
/// output vectors are emitted in the fixed order of the static tables above so a
/// serialized fingerprint is byte-stable. Single pass per signal, no regex.
pub fn fingerprint_files(files: &[(String, String)]) -> Fingerprint {
    let mut fp = Fingerprint::default();

    // Presence bitsets, so `imports`/`primitives` stay in table order regardless
    // of which file happened to hit first.
    let mut dep_seen = vec![false; DEPS.len()];
    let mut prim_seen = vec![false; PRIMITIVES.len()];

    for (path, content) in files {
        let lower_path = path.to_ascii_lowercase();
        let is_tsx = lower_path.ends_with(".tsx");
        let in_repos_dir = lower_path.contains("repos/");

        for (i, dep) in DEPS.iter().enumerate() {
            if dep_seen[i] {
                continue;
            }
            if let Some(spec) = dep.ts {
                if imports_ts_module(content, spec) {
                    dep_seen[i] = true;
                    continue;
                }
            }
            if let Some(prefix) = dep.rust {
                if count_bounded(content, prefix) > 0 {
                    dep_seen[i] = true;
                }
            }
        }

        for (i, prim) in PRIMITIVES.iter().enumerate() {
            if !prim_seen[i] && content.contains(prim) {
                prim_seen[i] = true;
            }
        }

        fp.promise_all_count += count(content, "Promise.all(");
        fp.join_all_count += count(content, "join_all(");
        fp.await_count += count_bounded(content, "await");
        fp.use_effect_count += count(content, "useEffect(");
        fp.spawn_count += count(content, "tokio::spawn")
            + count(content, "spawn_blocking")
            + count(content, "async_runtime::spawn");
        fp.sql_write_count += count_sql_writes(content);
        fp.set_state_after_await_count += count_set_state_after_await(content);

        if is_tsx && exports_component(content) {
            fp.exports_components = true;
        }
        if exports_hook(content) {
            fp.exports_hooks = true;
        }
        if content.contains("#[tauri::command]") {
            fp.exports_commands = true;
        }
        if in_repos_dir && content.contains("pub fn ") {
            fp.exports_repo_fns = true;
        }
    }

    fp.imports = DEPS
        .iter()
        .enumerate()
        .filter(|(i, _)| dep_seen[*i])
        .map(|(_, d)| d.name.to_string())
        .collect();
    fp.primitives = PRIMITIVES
        .iter()
        .enumerate()
        .filter(|(i, _)| prim_seen[*i])
        .map(|(_, p)| (*p).to_string())
        .collect();

    fp
}

// ============================================================================
// Scanners — all single-pass, allocation-free over the input
// ============================================================================

fn count(content: &str, needle: &str) -> i32 {
    content.matches(needle).count() as i32
}

fn is_ident_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_' || c == b'$'
}

/// Count `needle` occurrences whose preceding character is not an identifier
/// character, so `my_tokio::` does not count as `tokio::` and `reawait` does not
/// count as `await`. For alphabetic needles the trailing side is checked too.
fn count_bounded(content: &str, needle: &str) -> i32 {
    let bytes = content.as_bytes();
    let needle_ends_in_ident = needle
        .as_bytes()
        .last()
        .copied()
        .map(is_ident_char)
        .unwrap_or(false);
    let mut n = 0i32;
    for (idx, _) in content.match_indices(needle) {
        if idx > 0 && is_ident_char(bytes[idx - 1]) {
            continue;
        }
        if needle_ends_in_ident {
            let after = idx + needle.len();
            if after < bytes.len() && is_ident_char(bytes[after]) {
                continue;
            }
        }
        n += 1;
    }
    n
}

/// True when `content` imports the JS/TS module `spec` — either exactly, or as a
/// subpath (`spec/thing`). Reads the quoted specifier after `from ` / `require(`
/// rather than formatting per-dep needles, so this allocates nothing.
fn imports_ts_module(content: &str, spec: &str) -> bool {
    for anchor in ["from ", "require("] {
        for (idx, _) in content.match_indices(anchor) {
            let rest = &content[idx + anchor.len()..];
            let rest = rest.trim_start_matches(' ');
            let quote = match rest.as_bytes().first() {
                Some(&q) if q == b'\'' || q == b'"' || q == b'`' => q as char,
                _ => continue,
            };
            let body = &rest[1..];
            let end = match body.find(quote) {
                Some(e) => e,
                None => continue,
            };
            let found = &body[..end];
            // Exact, or a subpath import — compared without allocating a needle.
            if found == spec
                || (found.starts_with(spec) && found.as_bytes().get(spec.len()) == Some(&b'/'))
            {
                return true;
            }
        }
    }
    false
}

fn is_comment_line(trimmed: &str) -> bool {
    trimmed.starts_with("//")
        || trimmed.starts_with("/*")
        || trimmed.starts_with('*')
        || trimmed.starts_with("--")
        || trimmed.starts_with('#')
}

/// SQL writes: an uppercase `INSERT `/`UPDATE `/`DELETE ` on a line that also
/// carries a quote character. The quote requirement is the "inside a string
/// literal" proxy — a real tokenizer would be far more code for a counter whose
/// only job is to route a question to the right contexts. Comment lines are
/// skipped because these needles are also plain English.
///
/// Known blind spot: a multi-line SQL string whose write keyword sits on a
/// continuation line with no quote of its own is missed. Contexts that write SQL
/// essentially always have at least one single-line quoted statement too, so the
/// counter stays useful for routing.
fn count_sql_writes(content: &str) -> i32 {
    let mut n = 0i32;
    for line in content.lines() {
        let trimmed = line.trim_start();
        if is_comment_line(trimmed) {
            continue;
        }
        if !(line.contains('"') || line.contains('\'') || line.contains('`')) {
            continue;
        }
        n += count(line, "INSERT ") + count(line, "UPDATE ") + count(line, "DELETE ");
    }
    n
}

/// `setFoo(` at an identifier boundary, or `.store(`.
fn has_setter_call(line: &str) -> bool {
    if line.contains(".store(") {
        return true;
    }
    let bytes = line.as_bytes();
    for (idx, _) in line.match_indices("set") {
        if idx > 0 && is_ident_char(bytes[idx - 1]) {
            continue;
        }
        let after = idx + 3;
        // `set` must be followed by an uppercase letter (setFoo, setIsLoading).
        if after >= bytes.len() || !bytes[after].is_ascii_uppercase() {
            continue;
        }
        // …then identifier characters up to an opening paren.
        let mut j = after;
        while j < bytes.len() && is_ident_char(bytes[j]) {
            j += 1;
        }
        if j < bytes.len() && bytes[j] == b'(' {
            return true;
        }
    }
    false
}

/// See [`Fingerprint::set_state_after_await_count`] — a proxy for the stale-write
/// shape, counted at most once per async site.
fn count_set_state_after_await(content: &str) -> i32 {
    let lines: Vec<&str> = content.lines().collect();
    let mut n = 0i32;
    for (i, line) in lines.iter().enumerate() {
        let async_site = count_bounded(line, "await") > 0 || line.contains(".then(");
        if !async_site {
            continue;
        }
        let end = (i + AWAIT_WINDOW_LINES).min(lines.len().saturating_sub(1));
        for probe in lines.iter().take(end + 1).skip(i) {
            if has_setter_call(probe) {
                n += 1;
                break;
            }
        }
    }
    n
}

/// A `.tsx` file that exports a component: a default export, or an exported
/// capitalized symbol (`export function Foo(` / `export const Foo =`). Checking
/// whether the body literally returns JSX would need a parser; in a `.tsx` file
/// an exported capitalized symbol is the convention.
fn exports_component(content: &str) -> bool {
    if content.contains("export default") {
        return true;
    }
    exported_symbol_starts_uppercase(content, "export function ")
        || exported_symbol_starts_uppercase(content, "export const ")
}

fn exported_symbol_starts_uppercase(content: &str, anchor: &str) -> bool {
    for (idx, _) in content.match_indices(anchor) {
        let rest = &content[idx + anchor.len()..];
        if rest.as_bytes().first().is_some_and(|c| c.is_ascii_uppercase()) {
            return true;
        }
    }
    false
}

/// `export function useFoo` / `export const useFoo` — the `use` prefix must be
/// followed by an uppercase letter so `export const used = …` is not a hook.
fn exports_hook(content: &str) -> bool {
    for anchor in ["export function use", "export const use"] {
        for (idx, _) in content.match_indices(anchor) {
            let rest = &content[idx + anchor.len()..];
            if rest.as_bytes().first().is_some_and(|c| c.is_ascii_uppercase()) {
                return true;
            }
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn f(path: &str, content: &str) -> Vec<(String, String)> {
        vec![(path.to_string(), content.to_string())]
    }

    #[test]
    fn empty_input_yields_zeroed_fingerprint() {
        let fp = fingerprint_files(&[]);
        assert_eq!(fp, Fingerprint::default());
        assert!(fp.imports.is_empty());
        assert!(fp.primitives.is_empty());
        assert_eq!(fp.await_count, 0);
        assert!(!fp.exports_components);
        assert!(!fp.exports_hooks);
        assert!(!fp.exports_commands);
        assert!(!fp.exports_repo_fns);
    }

    #[test]
    fn detects_ts_imports_exactly_and_by_subpath() {
        let fp = fingerprint_files(&f(
            "src/features/x/X.tsx",
            "import React from 'react';\n\
             import { create } from \"zustand\";\n\
             import { motion } from 'framer-motion/dist/es';\n",
        ));
        assert_eq!(fp.imports, vec!["react", "zustand", "framer-motion"]);
    }

    #[test]
    fn ts_import_does_not_match_a_different_package_with_the_same_prefix() {
        let fp = fingerprint_files(&f("a.ts", "import x from 'react-native-web';\n"));
        assert!(fp.imports.is_empty(), "got {:?}", fp.imports);
    }

    #[test]
    fn detects_rust_crates_at_identifier_boundaries() {
        let fp = fingerprint_files(&f(
            "src-tauri/src/x.rs",
            "use rusqlite::params;\nuse ts_rs::TS;\nlet c = reqwest::Client::new();\n",
        ));
        assert_eq!(fp.imports, vec!["rusqlite", "reqwest", "ts-rs"]);
    }

    #[test]
    fn rust_crate_prefix_is_not_matched_inside_a_longer_identifier() {
        let fp = fingerprint_files(&f("x.rs", "use my_tokio::spawnish;\n"));
        assert!(fp.imports.is_empty(), "got {:?}", fp.imports);
    }

    #[test]
    fn imports_and_primitives_are_emitted_in_table_order() {
        // Files deliberately in reverse table order.
        let files = vec![
            ("b.rs".to_string(), "use tokio::time;\n".to_string()),
            ("a.tsx".to_string(), "import 'x';\nimport React from 'react';\n".to_string()),
            ("c.ts".to_string(), "silentCatch(e);\ninvokeWithTimeout(x);\n".to_string()),
        ];
        let fp = fingerprint_files(&files);
        assert_eq!(fp.imports, vec!["react", "tokio"]);
        assert_eq!(fp.primitives, vec!["invokeWithTimeout", "silentCatch"]);
    }

    #[test]
    fn detects_in_repo_primitives() {
        let fp = fingerprint_files(&f(
            "src/lib/x.ts",
            "const run = createLatestWins();\nawait mapWithConcurrency(items, 4, fn);\n",
        ));
        assert_eq!(fp.primitives, vec!["createLatestWins", "mapWithConcurrency"]);
    }

    #[test]
    fn counts_concurrency_and_effect_shapes() {
        let fp = fingerprint_files(&f(
            "x.ts",
            "await Promise.all([a, b]);\nawait Promise.all([c]);\nuseEffect(() => {}, []);\n",
        ));
        assert_eq!(fp.promise_all_count, 2);
        assert_eq!(fp.use_effect_count, 1);
        assert_eq!(fp.await_count, 2);
    }

    #[test]
    fn join_all_count_includes_try_join_all() {
        let fp = fingerprint_files(&f(
            "x.rs",
            "let a = join_all(futs).await;\nlet b = try_join_all(more).await?;\n",
        ));
        assert_eq!(fp.join_all_count, 2);
    }

    #[test]
    fn await_count_is_word_bounded_across_both_languages() {
        let fp = fingerprint_files(&f(
            "x.rs",
            "// awaiting is not a match, nor is reawait\n\
             let a = foo().await?;\n\
             let b = bar().await;\n",
        ));
        assert_eq!(fp.await_count, 2);
    }

    #[test]
    fn counts_spawn_forms() {
        let fp = fingerprint_files(&f(
            "x.rs",
            "tokio::spawn(async {});\n\
             tokio::task::spawn_blocking(|| {});\n\
             tauri::async_runtime::spawn(async {});\n",
        ));
        // `tokio::spawn` + `spawn_blocking` + `async_runtime::spawn`.
        assert_eq!(fp.spawn_count, 3);
    }

    #[test]
    fn sql_writes_counted_inside_string_literals_only() {
        let fp = fingerprint_files(&f(
            "x.rs",
            "// UPDATE the docs when this changes\n\
             conn.execute(\"INSERT INTO t (a) VALUES (?1)\", params![a])?;\n\
             conn.execute(\"DELETE FROM t WHERE a = ?1\", params![a])?;\n\
             let plain = INSERT_CONST;\n",
        ));
        assert_eq!(fp.sql_write_count, 2);
    }

    #[test]
    fn set_state_after_await_fires_on_the_shape() {
        let fp = fingerprint_files(&f(
            "x.tsx",
            "const data = await load();\nsetRows(data);\n",
        ));
        assert_eq!(fp.set_state_after_await_count, 1);
    }

    #[test]
    fn set_state_after_await_fires_on_the_then_shape_and_on_store() {
        let fp = fingerprint_files(&f(
            "x.ts",
            "load().then((d) => {\n  flag.store(true, Ordering::SeqCst);\n});\n",
        ));
        assert_eq!(fp.set_state_after_await_count, 1);
    }

    #[test]
    fn set_state_far_from_an_await_does_not_fire() {
        let fp = fingerprint_files(&f(
            "x.tsx",
            "const data = await load();\n\
             const a = 1;\n\
             const b = 2;\n\
             const c = 3;\n\
             const d = 4;\n\
             const e = 5;\n\
             setRows(data);\n",
        ));
        assert_eq!(fp.await_count, 1, "the await is still counted");
        assert_eq!(
            fp.set_state_after_await_count, 0,
            "setter is 6 lines past the await — outside the window"
        );
    }

    #[test]
    fn setter_without_any_await_does_not_fire() {
        let fp = fingerprint_files(&f("x.tsx", "setRows([]);\nsetLoading(false);\n"));
        assert_eq!(fp.set_state_after_await_count, 0);
    }

    #[test]
    fn lowercase_settle_is_not_a_setter() {
        // `settle(` and `setting` must not read as `setFoo(`.
        let fp = fingerprint_files(&f("x.ts", "await go();\nsettle(x);\nconst setting = 1;\n"));
        assert_eq!(fp.set_state_after_await_count, 0);
    }

    #[test]
    fn one_async_site_counts_at_most_once() {
        let fp = fingerprint_files(&f(
            "x.tsx",
            "const d = await load();\nsetA(d);\nsetB(d);\nsetC(d);\n",
        ));
        assert_eq!(fp.set_state_after_await_count, 1);
    }

    #[test]
    fn surface_flag_components_needs_a_tsx_file() {
        let tsx = fingerprint_files(&f("src/x/Panel.tsx", "export default function Panel() {}\n"));
        assert!(tsx.exports_components);

        let ts = fingerprint_files(&f("src/x/panel.ts", "export default function Panel() {}\n"));
        assert!(!ts.exports_components, "a .ts module is not a component surface");
    }

    #[test]
    fn surface_flag_components_on_exported_capitalized_symbol() {
        let fp = fingerprint_files(&f("src/x/Panel.tsx", "export function Panel() { return null; }\n"));
        assert!(fp.exports_components);

        let lower = fingerprint_files(&f("src/x/util.tsx", "export function helper() {}\n"));
        assert!(!lower.exports_components);
    }

    #[test]
    fn surface_flag_hooks() {
        let fp = fingerprint_files(&f("src/hooks/useThing.ts", "export function useThing() {}\n"));
        assert!(fp.exports_hooks);
        assert!(!fp.exports_components, ".ts file, no component flag");

        let not_hook = fingerprint_files(&f("src/x.ts", "export const used = true;\n"));
        assert!(!not_hook.exports_hooks);
    }

    #[test]
    fn surface_flag_commands() {
        let fp = fingerprint_files(&f(
            "src-tauri/src/commands/x.rs",
            "#[tauri::command]\npub async fn do_thing() {}\n",
        ));
        assert!(fp.exports_commands);
        assert!(!fp.exports_repo_fns, "not under repos/");
    }

    #[test]
    fn surface_flag_repo_fns_requires_a_repos_path() {
        let inside = fingerprint_files(&f(
            "src-tauri/db/src/repos/dev_tools.rs",
            "pub fn list_things() {}\n",
        ));
        assert!(inside.exports_repo_fns);

        let outside = fingerprint_files(&f("src-tauri/src/engine/x.rs", "pub fn list_things() {}\n"));
        assert!(!outside.exports_repo_fns);
    }

    #[test]
    fn counters_accumulate_across_files_and_flags_are_sticky() {
        let files = vec![
            ("a.tsx".to_string(), "export default function A() {}\nuseEffect(() => {}, []);\n".to_string()),
            ("b.ts".to_string(), "export function useB() {}\nuseEffect(() => {}, []);\n".to_string()),
        ];
        let fp = fingerprint_files(&files);
        assert_eq!(fp.use_effect_count, 2);
        assert!(fp.exports_components);
        assert!(fp.exports_hooks);
    }

    #[test]
    fn fingerprinting_is_deterministic_for_identical_input() {
        let files = vec![
            ("a.tsx".to_string(), "import React from 'react';\nawait x();\nsetY(1);\n".to_string()),
            ("b.rs".to_string(), "use rusqlite::params;\nconn.execute(\"UPDATE t SET a = 1\", [])?;\n".to_string()),
        ];
        assert_eq!(fingerprint_files(&files), fingerprint_files(&files));
    }
}
