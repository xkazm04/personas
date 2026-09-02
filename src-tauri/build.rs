fn main() {
    // ts-rs export-dir contract. The `[env]` table in `.cargo/config.toml`
    // sets `TS_RS_EXPORT_DIR` for cargo and most subprocesses, but in
    // practice the proc-macro expansion path (which is what reads this var
    // to decide where `#[ts(export)]` writes bindings) does NOT reliably
    // inherit it — the dual-tree drift (`src-tauri/bindings/` AND
    // `src/lib/bindings/`) documented in earlier session notes traces back
    // to that. Passing the value via `cargo:rustc-env` here writes it
    // directly into rustc's compile-time env for THIS crate, which the
    // ts-rs derive's `env::var` call DOES see. Result: every
    // `cargo test export_bindings` (or any rebuild that touches a `#[ts(
    // export)]` type) writes a single source of truth at
    // `src/lib/bindings/`.
    //
    // The path is resolved at build-script run time against the manifest
    // dir (= `src-tauri/`), so `../src/lib/bindings` lands on repo-root
    // `src/lib/bindings/`. We also emit a rerun-if-env-changed so a user
    // who overrides the env (e.g. for a one-off test) gets the build.rs
    // re-evaluated on the next compile.
    println!("cargo:rustc-env=TS_RS_EXPORT_DIR=../src/lib/bindings");
    println!("cargo:rerun-if-env-changed=TS_RS_EXPORT_DIR");

    // Load .env and forward selected variables to rustc so that
    // `option_env!("SUPABASE_URL")` etc. resolve at compile time.
    // This embeds credentials into the binary for production installs.
    if let Ok(path) = dotenvy::dotenv() {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    // Forward specific env vars from .env → rustc compile-time environment.
    // Only variables consumed by `option_env!()` in the crate need forwarding.
    for key in &[
        "SUPABASE_URL",
        "SUPABASE_ANON_KEY",
        "GCP_CLIENT_ID",
        "GCP_CLIENT_SECRET",
        "GCP_DESKTOP_CLIENT_ID",
        "GCP_DESKTOP_CLIENT_SECRET",
        "MICROSOFT_CLIENT_ID",
        "MICROSOFT_CLIENT_SECRET",
        "SENTRY_DSN",
    ] {
        // Re-run this build script (and re-embed the value) whenever the var's
        // VALUE changes — not just when the .env file path changes. Without
        // this, a rotated secret (e.g. CI swapping SENTRY_DSN) is ignored:
        // Cargo, having emitted at least one rerun-if-* directive, only re-runs
        // build.rs on the triggers it was told about, so a cached build-script
        // output silently ships the previous (or empty) value. swatinem/rust-
        // cache restores target/ across CI runs, making this a live release
        // hazard rather than a theoretical one.
        println!("cargo:rerun-if-env-changed={key}");
        if let Ok(val) = std::env::var(key) {
            if !val.trim().is_empty() {
                println!("cargo:rustc-env={key}={val}");
            }
        }
    }

    embed_template_index();

    tauri_build::build()
}

/// Aggregate `scripts/templates/<category>/*.json` into one
/// `$OUT_DIR/template_index.json` so the build-session prompt's "Reference
/// Templates" section survives into a packaged install.
///
/// **Why this exists.** `engine::build_session::templates` reads the catalog
/// off disk. On this machine that works (three candidate paths, one of them a
/// `CARGO_MANIFEST_DIR` anchor); on an end user's machine none of them can —
/// `tauri.conf.json` bundles only `resources/skills`, so a shipped installer
/// carries no `scripts/` directory at all. The catalog therefore has to travel
/// inside the binary, and this is the only place that can put it there.
///
/// **Why it concatenates whole files instead of extracting four fields.**
/// Extracting `name` / `description` / `category` / `service_flow` here would
/// need a JSON parser, and `[build-dependencies]` has none (adding one is a
/// `Cargo.toml` change, outside this change's write set). Concatenating the
/// raw objects into one array needs no parser — each template file is already
/// a JSON object — and the consumer, which does have `serde_json`, extracts
/// the four fields exactly as it does from disk. The cost is ~2.3 MB of
/// `rodata` instead of the ~40 KB a projected index would take; a one-line
/// `serde_json` build-dependency would close that gap and is the obvious
/// follow-up if the size ever matters.
///
/// Selection rules mirror `load_template_index` exactly: category directories
/// and files whose name starts with `_` are internal bundles
/// (`_archetypes.json`, `_recipe_seeds.json`, `_team_presets/`) and are
/// skipped. Output order is sorted so the embedded blob is reproducible.
///
/// Panics if the directory is missing: it is always present in the repo, and a
/// silent empty index is the exact defect this whole change is undoing.
fn embed_template_index() {
    // CWD for a build script is the manifest dir (`src-tauri/`).
    let root = std::path::Path::new("../scripts/templates");
    println!("cargo:rerun-if-changed=../scripts/templates");
    assert!(
        root.is_dir(),
        "scripts/templates is missing (looked at {}). It is committed to the \
         repo and the persona-build prompt's template grounding is embedded \
         from it — a build without it would silently ship an empty catalog.",
        root.display()
    );

    let mut category_dirs: Vec<std::path::PathBuf> = std::fs::read_dir(root)
        .expect("scripts/templates is readable")
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_dir()
                && p.file_name()
                    .map(|n| !n.to_string_lossy().starts_with('_'))
                    .unwrap_or(false)
        })
        .collect();
    category_dirs.sort();

    let mut objects: Vec<String> = Vec::new();
    for dir in &category_dirs {
        println!("cargo:rerun-if-changed={}", dir.display());
        let mut files: Vec<std::path::PathBuf> = std::fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("{} is readable: {e}", dir.display()))
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map(|x| x == "json").unwrap_or(false)
                    && p.file_name()
                        .map(|n| !n.to_string_lossy().starts_with('_'))
                        .unwrap_or(false)
            })
            .collect();
        files.sort();
        for f in files {
            // Per-file rerun: a directory's mtime moves when a file is added or
            // removed, NOT when an existing one is edited.
            println!("cargo:rerun-if-changed={}", f.display());
            let raw = match std::fs::read_to_string(&f) {
                Ok(r) => r,
                Err(e) => {
                    println!("cargo:warning=template {} unreadable: {e}", f.display());
                    continue;
                }
            };
            let trimmed = raw.trim();
            // Cheap well-formedness guard — enough to keep the aggregate itself
            // parseable. A file that is valid JSON but not an object would
            // still be handled by the consumer (it reads fields defensively).
            if !trimmed.starts_with('{') || !trimmed.ends_with('}') {
                println!(
                    "cargo:warning=template {} is not a JSON object — skipped",
                    f.display()
                );
                continue;
            }
            objects.push(trimmed.to_string());
        }
    }

    assert!(
        !objects.is_empty(),
        "scripts/templates exists but yielded zero templates — the walk is \
         broken, not the catalog"
    );

    let out = std::path::Path::new(&std::env::var("OUT_DIR").expect("OUT_DIR is set"))
        .join("template_index.json");
    std::fs::write(&out, format!("[{}]", objects.join(",")))
        .unwrap_or_else(|e| panic!("writing {}: {e}", out.display()));
}
