// Hand-maintained: the Rust `engine::healthcheck::HealthcheckResult` has no
// ts-rs derive (serde-only), so this file tracks its wire shape manually.
// `state` was added in wave 9 (HealthProbeState, serde camelCase).
//
// `unreachable` was missing here until 2026-09-17 although `HealthProbeState`
// has carried it since wave 9 and `HealthcheckResult::unreachable()`
// (src-tauri/src/engine/healthcheck.rs) returns it: a connect / DNS / timeout
// failure. It is NOT a verdict about the credential — `is_verdict()` says so
// and `persist_probe_state` refuses to store it over the last real state — so
// omitting it from the union made "could not reach" unrepresentable on the TS
// side and every consumer folded it into `failed`.

export type HealthcheckResult = { success: boolean, message: string, state: "verified" | "unverifiable" | "failed" | "unreachable", };
