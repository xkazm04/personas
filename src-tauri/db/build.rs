fn main() {
    // ts-rs export-dir contract — MUST be duplicated per crate.
    //
    // `cargo:rustc-env` applies only to THE CRATE THAT EMITS IT, and the ts-rs
    // derive reads this var at proc-macro expansion time to decide where
    // `#[ts(export)]` writes. The `[env]` table in `.cargo/config.toml` does not
    // reliably reach that path — that is what produced the old
    // `src-tauri/bindings/` vs `src/lib/bindings/` dual-tree drift.
    //
    // Resolved against THIS crate's manifest dir (`src-tauri/db/`), so the path
    // needs one more `..` than the desktop crate's.
    println!("cargo:rustc-env=TS_RS_EXPORT_DIR=../../src/lib/bindings");
    println!("cargo:rerun-if-env-changed=TS_RS_EXPORT_DIR");
}
