fn main() {
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
    ] {
        if let Ok(val) = std::env::var(key) {
            if !val.trim().is_empty() {
                println!("cargo:rustc-env={key}={val}");
            }
        }
    }

    tauri_build::build()
}
