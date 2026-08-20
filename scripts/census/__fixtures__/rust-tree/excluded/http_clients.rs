//! Census self-test fixture — stand-in for `src-tauri/core/src/http_clients.rs`,
//! the chokepoint the rule routes callers TO. It must construct clients, so the
//! rule excludes it; the exclude entry is what this file exists to exercise.

pub static SHARED_HTTP: LazyLock<reqwest::Client> =
    LazyLock::new(|| reqwest::Client::builder().build().unwrap());

pub static SECOND_HTTP: LazyLock<reqwest::Client> = LazyLock::new(reqwest::Client::new);

pub fn third() -> reqwest::Client {
    reqwest::Client::builder().build().unwrap()
}
