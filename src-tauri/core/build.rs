fn main() {
    // ts-rs export-dir contract — MUST be duplicated per crate.
    //
    // `personas-desktop/build.rs` carries the same line, and its comment
    // explains why the `[env]` table in `.cargo/config.toml` is not sufficient:
    // the proc-macro expansion path (which is what reads this var to decide
    // where `#[ts(export)]` writes) does NOT reliably inherit it, and that is
    // what produced the `src-tauri/bindings/` vs `src/lib/bindings/` dual-tree
    // drift. `cargo:rustc-env` writes it into rustc's compile-time env, which
    // the derive's `env::var` DOES see — but only for THE CRATE THAT EMITS IT.
    //
    // So every crate in this workspace that holds a `#[ts(export)]` type needs
    // its own copy of this line. `error_taxonomy` (moved here in crate-split
    // step 2) has two such types; without this build script its bindings would
    // silently land somewhere else and re-open the drift.
    //
    // The value is resolved by ts-rs against THIS crate's manifest dir
    // (= `src-tauri/core/`), so the path needs one more `..` than the desktop
    // crate's: `../../src/lib/bindings` -> repo-root `src/lib/bindings/`.
    println!("cargo:rustc-env=TS_RS_EXPORT_DIR=../../src/lib/bindings");
    println!("cargo:rerun-if-env-changed=TS_RS_EXPORT_DIR");
}
