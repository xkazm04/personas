fn main() {
    // ts-rs export-dir contract — MUST be duplicated per crate. `cargo:rustc-env`
    // applies only to the crate that emits it, and the ts-rs derive reads this at
    // proc-macro expansion time to decide where `#[ts(export)]` writes. See the
    // identical note in core/build.rs and db/build.rs.
    println!("cargo:rustc-env=TS_RS_EXPORT_DIR=../../src/lib/bindings");
    println!("cargo:rerun-if-env-changed=TS_RS_EXPORT_DIR");
}
