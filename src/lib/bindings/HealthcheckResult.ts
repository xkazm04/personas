// Hand-maintained: the Rust `engine::healthcheck::HealthcheckResult` has no
// ts-rs derive (serde-only), so this file tracks its wire shape manually.
// `state` was added in wave 9 (HealthProbeState, serde camelCase).

export type HealthcheckResult = { success: boolean, message: string, state: "verified" | "unverifiable" | "failed", };
