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

    tauri_build::build()
}
