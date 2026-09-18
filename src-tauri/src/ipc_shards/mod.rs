//! The IPC command surface: eight registration lists and the router over them.
//!
//! # Adding a command
//!
//! Add its path to the list in whichever `shard_N.rs` already holds its family
//! (the section comments say which). That is the whole registration: the wire
//! name, the dispatch arm and the router's ownership test all come from that one
//! line. Then `node scripts/generate-command-names.mjs` as before. If a shard
//! grows far past its siblings (~200 entries each), start a new one and add it
//! to the `mod` list and the `shards!` call below.
//!
//! # Why the list is split
//!
//! Tauri accepts ONE invoke handler, and its handler macro expands to one
//! closure holding a `match` with an arm per command, each arm inlining that
//! command's argument-deserialisation wrapper. rustc's cost for that single body
//! is super-linear in the arm count. Measured 2026-09-18 on a cold
//! `cargo check --lib --features desktop` of this crate (dependencies warm),
//! 1,607 commands: one list 259-349 s, eight lists 127-132 s, same peak memory
//! class (5.3 vs 5.5 GB). Incremental rebuilds did not move (23.5 s either way):
//! that floor is crate-wide. Rows: `docs/development/build-ledger.jsonl`,
//! scenario `rust-check-cold-applib`, variants `baseline` / `handler-shards-8`.
//!
//! # Why there is a router
//!
//! An `Invoke` is moved into whichever closure receives it, so shards cannot be
//! tried one after another. `personas_macros::ipc_shard!` therefore derives,
//! from the same token list it hands to Tauri's macro, an `owns(name)` predicate
//! with the same `#[cfg]` on every arm; the router asks `owns` first and moves
//! the invoke exactly once. A name no shard owns returns `false`, which is what
//! Tauri's own macro returns from its `_` arm, so an unknown command is rejected
//! by Tauri core exactly as before.
//!
//! `ipc_auth::wrap_invoke_handler` still wraps the ROUTER (see `lib.rs`), once,
//! so token validation runs before any shard sees the invoke.

/// What `personas_macros::ipc_shard!` expands to: the ownership predicate and
/// the dispatch closure Tauri's macro built.
type Shard<F> = (fn(&str) -> bool, F);

// Declared outside the macro on purpose: `cargo fmt` only formats modules it can
// see in the source, and a `mod` emitted by a macro is invisible to it.
mod shard_0;
mod shard_1;
mod shard_2;
mod shard_3;
mod shard_4;
mod shard_5;
mod shard_6;
mod shard_7;

macro_rules! shards {
    ($($module:ident),+ $(,)?) => {
        /// The single invoke handler for the app: routes by wire name to the
        /// shard that registered it.
        pub(crate) fn handler(
        ) -> impl Fn(tauri::ipc::Invoke<tauri::Wry>) -> bool + Send + Sync + 'static {
            let shards = ($($module::shard(),)+);
            move |invoke| {
                let ($($module,)+) = &shards;
                $(
                    if ($module.0)(invoke.message.command()) {
                        return ($module.1)(invoke);
                    }
                )+
                false
            }
        }
    };
}

shards!(shard_0, shard_1, shard_2, shard_3, shard_4, shard_5, shard_6, shard_7);

/// Structural guard for the `generate_handler!` registration list.
///
/// Rust silently applies a *stack* of `#[cfg(...)]` attributes to whatever item
/// comes next, so a line like
///
/// ```text
/// #[cfg(feature = "p2p")]
/// #[cfg(feature = "p2p")]
/// commands::network::exposure::create_exposed_resource,
/// ```
///
/// compiles cleanly while the command that was *supposed* to sit under the first
/// cfg has silently vanished from the IPC surface. That exact bug removed 15
/// `commands::network::*` commands from `generate_handler!` and shipped —
/// nothing in the compiler, clippy, or the test suite noticed, because the
/// missing entry is a *deletion*, not an error.
///
/// This test parses the source text (not the macro expansion, which is
/// feature-gated and therefore can't be reflected on in a lite build) and
/// asserts the two lists agree. It is intentionally NOT `#[cfg(feature = "p2p")]`
/// so it guards the registration list in every build configuration.
#[cfg(test)]
mod network_command_registration_tests {
    use std::collections::BTreeSet;

    /// Extract `name` from a `pub fn name(` / `pub async fn name(` signature line.
    fn command_fn_name(line: &str) -> Option<&str> {
        let rest = line.trim().strip_prefix("pub ")?;
        let rest = rest.strip_prefix("async ").unwrap_or(rest);
        let rest = rest.strip_prefix("fn ")?;
        let end = rest.find(['(', '<', ' '])?;
        let name = &rest[..end];
        if name.is_empty() {
            None
        } else {
            Some(name)
        }
    }

    /// Every `#[tauri::command]`-annotated fn under `src/commands/network/`,
    /// as `("<module>", "<fn name>")`.
    fn declared_network_commands() -> BTreeSet<(String, String)> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/commands/network");
        let mut found = BTreeSet::new();
        let entries = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") {
                continue;
            }
            let module = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string();
            if module == "mod" {
                continue;
            }
            let content = std::fs::read_to_string(&path).expect("read command module");
            let lines: Vec<&str> = content.lines().collect();
            for (i, line) in lines.iter().enumerate() {
                if line.trim() != "#[tauri::command]" {
                    continue;
                }
                // Skip any attributes between the marker and the signature
                // (`#[allow(...)]`, doc comments, `#[cfg(...)]`, ...).
                let mut j = i + 1;
                while let Some(next) = lines.get(j) {
                    let t = next.trim();
                    if t.starts_with('#') || t.starts_with("///") || t.starts_with("//") {
                        j += 1;
                    } else {
                        break;
                    }
                }
                let sig = lines.get(j).unwrap_or_else(|| {
                    panic!(
                        "#[tauri::command] at {}:{} has no fn",
                        path.display(),
                        i + 1
                    )
                });
                let name = command_fn_name(sig).unwrap_or_else(|| {
                    panic!(
                        "cannot parse fn name from {}:{} -- {sig:?}",
                        path.display(),
                        j + 1
                    )
                });
                found.insert((module.clone(), name.to_string()));
            }
        }
        found
    }

    /// The bodies of every shard's handler list under `src/ipc_shards/`,
    /// concatenated. Each `shard_N.rs` holds exactly one list.
    fn generate_handler_body() -> String {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/ipc_shards");
        let mut shards: Vec<std::path::PathBuf> = std::fs::read_dir(&dir)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", dir.display()))
            .flatten()
            .map(|entry| entry.path())
            .filter(|p| {
                p.file_name()
                    .and_then(|n| n.to_str())
                    .is_some_and(|n| n.starts_with("shard_") && n.ends_with(".rs"))
            })
            .collect();
        shards.sort();
        assert!(
            shards.len() >= 2,
            "expected several shard_N.rs files under {}, found {} -- the source walk is broken",
            dir.display(),
            shards.len()
        );
        shards
            .iter()
            .map(|p| shard_list_body(p))
            .collect::<Vec<_>>()
            .join(
                "
",
            )
    }

    /// The body of the one handler list in a shard file.
    fn shard_list_body(file: &std::path::Path) -> String {
        let src = std::fs::read_to_string(file)
            .unwrap_or_else(|e| panic!("cannot read {}: {e}", file.display()));
        let start = src
            .find("generate_handler![")
            .unwrap_or_else(|| panic!("{} must contain a handler list", file.display()));
        let open = start + "generate_handler![".len();
        // Bracket-match, but ONLY over code. The list carries prose comments,
        // and several of them quote `#[cfg(` — an unbalanced `[` that a naive
        // counter reads as real nesting. It did: from the commit that added
        // that comment until 2026-08-21 this fn panicked "unterminated" on
        // every run, taking BOTH tests in this module down with it, and the
        // failure looked like a missing `]` rather than a comment.
        let mut depth = 1usize;
        let bytes = src.as_bytes();
        let mut i = open;
        while i < bytes.len() {
            let c = bytes[i];
            match c {
                // line comment — skip to end of line
                b'/' if bytes.get(i + 1) == Some(&b'/') => {
                    while i < bytes.len() && bytes[i] != b'\n' {
                        i += 1;
                    }
                }
                // block comment — skip to the closing delimiter
                b'/' if bytes.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 2;
                }
                // string literal — skip it, honouring backslash escapes
                b'"' => {
                    i += 1;
                    while i < bytes.len() && bytes[i] != b'"' {
                        i += if bytes[i] == b'\\' { 2 } else { 1 };
                    }
                    i += 1;
                }
                b'[' => {
                    depth += 1;
                    i += 1;
                }
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return src[open..i].to_string();
                    }
                    i += 1;
                }
                _ => i += 1,
            }
        }
        panic!("unterminated handler list in {}", file.display());
    }

    /// A `#[cfg(...)]` line immediately followed by another attribute line with
    /// no item between them means the first cfg silently swallowed nothing --
    /// the entry it was meant to gate is gone. Catch the shape directly so the
    /// failure names the mechanism, not just the missing command.
    #[test]
    fn generate_handler_has_no_orphaned_cfg_attributes() {
        let body = generate_handler_body();
        let lines: Vec<&str> = body.lines().collect();
        let mut orphans = Vec::new();
        for (i, line) in lines.iter().enumerate() {
            let t = line.trim();
            if !t.starts_with("#[cfg(") {
                continue;
            }
            // Walk forward past comments; the next *code* line must be a path,
            // not another attribute.
            let mut j = i + 1;
            while let Some(next) = lines.get(j) {
                let n = next.trim();
                if n.is_empty() || n.starts_with("//") {
                    j += 1;
                } else {
                    break;
                }
            }
            if let Some(next) = lines.get(j) {
                if next.trim().starts_with("#[cfg(") {
                    orphans.push(format!("{}: {t}", i + 1));
                }
            } else {
                orphans.push(format!("{}: {t} (trailing)", i + 1));
            }
        }
        assert!(
            orphans.is_empty(),
            "stacked #[cfg] attributes with no item between them in generate_handler! \
             (each one silently deleted the command that belonged under it):\n{orphans:#?}"
        );
    }

    #[test]
    fn every_network_command_is_registered_in_generate_handler() {
        let declared = declared_network_commands();
        assert!(
            declared.len() > 20,
            "expected to find well over 20 #[tauri::command] fns under \
             src/commands/network/, found {} -- the source walk is broken, \
             not the app",
            declared.len()
        );

        let body = generate_handler_body();
        let missing: Vec<String> = declared
            .iter()
            .filter(|(module, name)| {
                let path = format!("commands::network::{module}::{name},");
                !body.contains(&path)
            })
            .map(|(module, name)| format!("commands::network::{module}::{name}"))
            .collect();

        assert!(
            missing.is_empty(),
            "network commands defined but NOT present in generate_handler! -- \
             they are unreachable from the frontend:\n{missing:#?}"
        );
    }
}
