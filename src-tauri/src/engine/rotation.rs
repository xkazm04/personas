//! Credential rotation engine.
//!
//! Evaluates rotation policies, refreshes OAuth tokens, runs healthchecks,
//! and records rotation history. Integrated into the scheduler background loop.
//!
//! Uses windowed anomaly scoring instead of a hard failure cutoff: a sliding
//! window of recent healthcheck results is maintained per credential, and
//! failure rates are computed over 5m/1h/24h windows. HTTP errors are
//! classified as transient (429, 503, timeout) vs permanent (401, 403),
//! and remediation policies vary accordingly.

use crate::db::repos::resources::credentials as cred_repo;
use crate::db::repos::resources::rotation as rotation_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::connector_strategy;
use super::cron;

// ---------------------------------------------------------------------------
// Windowed anomaly scoring constants
// ---------------------------------------------------------------------------

/// Ring buffer capacity — last N healthcheck results per credential.
const HEALTHCHECK_RING_BUFFER_SIZE: usize = 20;

/// Default failure-rate threshold for permanent errors (disables policy).
const DEFAULT_PERMANENT_FAILURE_THRESHOLD: f64 = 0.8;

/// Default failure-rate threshold for transient errors (triggers backoff).
const DEFAULT_TRANSIENT_FAILURE_THRESHOLD: f64 = 0.9;

/// Low tolerance for production-grade credentials (alert at 5%).
const PRODUCTION_TOLERANCE: f64 = 0.05;

/// High tolerance for development credentials (tolerate 50%).
const DEVELOPMENT_TOLERANCE: f64 = 0.50;

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/// Classify an HTTP status code extracted from a healthcheck/rotation message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum ErrorClass {
    /// Transient: rate-limit (429), service unavailable (503), gateway timeout (504), or network timeout.
    Transient,
    /// Permanent: unauthorized (401), forbidden (403), not found (404 for auth endpoints).
    Permanent,
    /// Unknown — could not classify.
    Unknown,
}

impl ErrorClass {
    pub fn from_status_code(code: u16) -> Self {
        match code {
            429 | 502 | 503 | 504 => Self::Transient,
            401 | 403 => Self::Permanent,
            _ if code >= 500 => Self::Transient,
            _ => Self::Unknown,
        }
    }

    /// Parse an error class from a healthcheck/rotation message string.
    /// Looks for patterns like "HTTP 429", "HTTP 401", "Connection failed", "timeout".
    pub fn from_message(msg: &str) -> Self {
        // Try to extract HTTP status code
        if let Some(code) = extract_http_status(msg) {
            return Self::from_status_code(code);
        }
        let lower = msg.to_lowercase();
        if lower.contains("timeout") || lower.contains("timed out") || lower.contains("connection refused") {
            return Self::Transient;
        }
        if lower.contains("unauthorized") || lower.contains("forbidden") || lower.contains("revoked") {
            return Self::Permanent;
        }
        Self::Unknown
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Transient => "transient",
            Self::Permanent => "permanent",
            Self::Unknown => "unknown",
        }
    }
}

fn extract_http_status(msg: &str) -> Option<u16> {
    // Match "HTTP 4xx" or "HTTP 5xx" patterns
    let patterns = ["HTTP ", "http "];
    for pat in &patterns {
        if let Some(idx) = msg.find(pat) {
            let after = &msg[idx + pat.len()..];
            let digits: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if let Ok(code) = digits.parse::<u16>() {
                if (100..=599).contains(&code) {
                    return Some(code);
                }
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Healthcheck ring buffer entry
// ---------------------------------------------------------------------------

/// A single healthcheck result stored in the ring buffer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct HealthcheckEntry {
    pub success: bool,
    pub status_code: Option<u16>,
    pub error_class: Option<String>,
    pub message: String,
    pub timestamp: String,
}

// ---------------------------------------------------------------------------
// Anomaly score summary
// ---------------------------------------------------------------------------

/// Computed anomaly scores for a credential based on its healthcheck ring buffer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AnomalyScore {
    /// Overall failure rate across the entire buffer.
    pub failure_rate_total: f64,
    /// Failure rate in the last 5 minutes.
    pub failure_rate_5m: f64,
    /// Failure rate in the last 1 hour.
    pub failure_rate_1h: f64,
    /// Failure rate in the last 24 hours.
    pub failure_rate_24h: f64,
    /// Failure rate for permanent errors only (1h window).
    pub permanent_failure_rate_1h: f64,
    /// Failure rate for transient errors only (1h window).
    pub transient_failure_rate_1h: f64,
    /// Recommended remediation action.
    pub remediation: Remediation,
    /// Number of entries in the ring buffer.
    pub sample_count: usize,
    /// Whether the window data may be stale (last entry > 10 min ago).
    pub data_stale: bool,
}

/// Remediation action recommended by the anomaly scorer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
pub enum Remediation {
    /// Credential is healthy — no action needed.
    Healthy,
    /// Transient failures detected — apply backoff and retry.
    BackoffRetry,
    /// Sustained degradation — trigger pre-emptive rotation.
    PreemptiveRotation,
    /// Permanent failure — attempt rotation, then alert if that fails.
    RotateThenAlert,
    /// Disable the policy — sustained permanent failures above threshold.
    Disable,
}

impl Remediation {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::BackoffRetry => "backoff_retry",
            Self::PreemptiveRotation => "preemptive_rotation",
            Self::RotateThenAlert => "rotate_then_alert",
            Self::Disable => "disable",
        }
    }
}

// ---------------------------------------------------------------------------
// Windowed anomaly scorer
// ---------------------------------------------------------------------------

/// Compute anomaly scores from a healthcheck ring buffer.
pub fn compute_anomaly_score(entries: &[HealthcheckEntry], tolerance: Option<f64>) -> AnomalyScore {
    let now = chrono::Utc::now();
    let _tolerance = tolerance.unwrap_or(DEFAULT_PERMANENT_FAILURE_THRESHOLD);

    let mut total_failures = 0usize;
    let mut count_5m = 0usize;
    let mut fail_5m = 0usize;
    let mut count_1h = 0usize;
    let mut fail_1h = 0usize;
    let mut perm_fail_1h = 0usize;
    let mut trans_fail_1h = 0usize;
    let mut count_24h = 0usize;
    let mut fail_24h = 0usize;

    let mut latest_ts: Option<chrono::DateTime<chrono::Utc>> = None;

    for entry in entries {
        if !entry.success {
            total_failures += 1;
        }

        let ts = chrono::DateTime::parse_from_rfc3339(&entry.timestamp)
            .ok()
            .map(|dt| dt.with_timezone(&chrono::Utc));

        if let Some(t) = ts {
            if latest_ts.map_or(true, |lt| t > lt) {
                latest_ts = Some(t);
            }

            let age = now - t;

            if age <= chrono::Duration::minutes(5) {
                count_5m += 1;
                if !entry.success {
                    fail_5m += 1;
                }
            }

            if age <= chrono::Duration::hours(1) {
                count_1h += 1;
                if !entry.success {
                    fail_1h += 1;
                    let ec = entry
                        .error_class
                        .as_deref()
                        .unwrap_or("unknown");
                    if ec == "permanent" {
                        perm_fail_1h += 1;
                    } else if ec == "transient" {
                        trans_fail_1h += 1;
                    }
                }
            }

            if age <= chrono::Duration::hours(24) {
                count_24h += 1;
                if !entry.success {
                    fail_24h += 1;
                }
            }
        } else {
            // No parseable timestamp — count against totals only
            if !entry.success {
                // Already counted above
            }
        }
    }

    let rate = |fails: usize, total: usize| -> f64 {
        if total == 0 {
            0.0
        } else {
            fails as f64 / total as f64
        }
    };

    let failure_rate_total = rate(total_failures, entries.len());
    let failure_rate_5m = rate(fail_5m, count_5m);
    let failure_rate_1h = rate(fail_1h, count_1h);
    let failure_rate_24h = rate(fail_24h, count_24h);
    let permanent_failure_rate_1h = rate(perm_fail_1h, count_1h);
    let transient_failure_rate_1h = rate(trans_fail_1h, count_1h);

    // Stale if the most recent entry is older than 10 minutes
    let data_stale = latest_ts
        .map(|lt| (now - lt) > chrono::Duration::minutes(10))
        .unwrap_or(true);

    // Determine remediation
    let remediation = if entries.is_empty() || count_1h == 0 {
        Remediation::Healthy
    } else if permanent_failure_rate_1h >= DEFAULT_PERMANENT_FAILURE_THRESHOLD {
        Remediation::Disable
    } else if permanent_failure_rate_1h > 0.0 && count_1h >= 3 {
        Remediation::RotateThenAlert
    } else if transient_failure_rate_1h >= DEFAULT_TRANSIENT_FAILURE_THRESHOLD {
        Remediation::BackoffRetry
    } else if failure_rate_1h > _tolerance && count_1h >= 3 {
        Remediation::PreemptiveRotation
    } else {
        Remediation::Healthy
    };

    AnomalyScore {
        failure_rate_total,
        failure_rate_5m,
        failure_rate_1h,
        failure_rate_24h,
        permanent_failure_rate_1h,
        transient_failure_rate_1h,
        remediation,
        sample_count: entries.len(),
        data_stale,
    }
}

/// Determine the tolerance threshold for a credential based on metadata hints.
/// Returns a fraction (0.0–1.0) representing the maximum acceptable failure rate.
pub fn resolve_tolerance(metadata: &serde_json::Value) -> f64 {
    // Check for explicit tolerance override
    if let Some(t) = metadata.get("anomaly_tolerance").and_then(|v| v.as_f64()) {
        return t.clamp(0.0, 1.0);
    }
    // Check environment hint
    if let Some(env) = metadata.get("environment").and_then(|v| v.as_str()) {
        return match env {
            "production" | "prod" => PRODUCTION_TOLERANCE,
            "development" | "dev" | "staging" => DEVELOPMENT_TOLERANCE,
            _ => DEFAULT_PERMANENT_FAILURE_THRESHOLD,
        };
    }
    DEFAULT_PERMANENT_FAILURE_THRESHOLD
}

/// Append a healthcheck result to the credential's ring buffer stored in metadata.
/// Returns the updated entries vector (capped at HEALTHCHECK_RING_BUFFER_SIZE).
pub fn append_healthcheck_entry(
    existing_entries: &[HealthcheckEntry],
    success: bool,
    message: &str,
) -> Vec<HealthcheckEntry> {
    let error_class = if success {
        None
    } else {
        Some(ErrorClass::from_message(message).as_str().to_string())
    };

    let status_code = extract_http_status(message);

    let entry = HealthcheckEntry {
        success,
        status_code,
        error_class,
        message: message.chars().take(200).collect(),
        timestamp: chrono::Utc::now().to_rfc3339(),
    };

    let mut entries = existing_entries.to_vec();
    entries.push(entry);

    // Maintain ring buffer size
    if entries.len() > HEALTHCHECK_RING_BUFFER_SIZE {
        entries = entries.split_off(entries.len() - HEALTHCHECK_RING_BUFFER_SIZE);
    }

    entries
}

/// Parse healthcheck entries from credential metadata JSON.
pub fn parse_healthcheck_entries(metadata: &serde_json::Value) -> Vec<HealthcheckEntry> {
    metadata
        .get("healthcheck_results")
        .and_then(|v| serde_json::from_value::<Vec<HealthcheckEntry>>(v.clone()).ok())
        .unwrap_or_default()
}

/// Evaluate all due rotation policies and execute rotations.
/// Called periodically from the background scheduler loop.
pub async fn evaluate_due_rotations(pool: &DbPool) {
    let now = chrono::Utc::now().to_rfc3339();

    let due_policies = match rotation_repo::get_due_policies(pool, &now) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("Rotation: failed to query due policies: {}", e);
            return;
        }
    };

    if due_policies.is_empty() {
        return;
    }

    tracing::info!(
        count = due_policies.len(),
        "Rotation: evaluating {} due policies",
        due_policies.len()
    );

    for policy in &due_policies {
        let credential = match cred_repo::get_by_id(pool, &policy.credential_id) {
            Ok(c) => c,
            Err(_) => {
                tracing::warn!(
                    policy_id = %policy.id,
                    credential_id = %policy.credential_id,
                    "Rotation: credential not found, skipping"
                );
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "skipped",
                    Some("Credential not found"),
                );
                continue;
            }
        };

        // Dispatch rotation through the connector strategy
        let strategy = connector_strategy::registry().get(&credential.service_type, None);
        let result = strategy.rotate(pool, &credential).await;

        match result {
            Ok(detail) => {
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "success",
                    Some(&detail),
                );
                let _ = rotation_repo::mark_rotated(pool, &policy.id);

                // Record success in the healthcheck ring buffer
                let metadata: serde_json::Value = credential
                    .metadata
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null);
                let existing = parse_healthcheck_entries(&metadata);
                let updated = append_healthcheck_entry(&existing, true, &detail);
                let mut meta_obj = metadata.as_object().cloned().unwrap_or_default();
                meta_obj.insert(
                    "healthcheck_results".to_string(),
                    serde_json::to_value(&updated).unwrap_or_default(),
                );
                let score = compute_anomaly_score(&updated, None);
                meta_obj.insert(
                    "anomaly_score".to_string(),
                    serde_json::to_value(&score).unwrap_or_default(),
                );
                let updated_meta = serde_json::to_string(&meta_obj).ok();
                let _ = cred_repo::update_metadata(pool, &policy.credential_id, updated_meta.as_deref());

                tracing::info!(
                    credential_id = %policy.credential_id,
                    "Rotation: successful — {}",
                    detail
                );
            }
            Err(e) => {
                let msg = e.to_string();
                let _ = rotation_repo::record_rotation(
                    pool,
                    &policy.credential_id,
                    &policy.policy_type,
                    "failed",
                    Some(&msg),
                );

                // ── Windowed anomaly scoring ──
                // Append failure to the credential's healthcheck ring buffer
                let metadata: serde_json::Value = credential
                    .metadata
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .unwrap_or(serde_json::Value::Null);

                let existing = parse_healthcheck_entries(&metadata);
                let updated = append_healthcheck_entry(&existing, false, &msg);
                let tolerance = resolve_tolerance(&metadata);
                let score = compute_anomaly_score(&updated, Some(tolerance));

                // Persist updated ring buffer back to credential metadata
                let mut meta_obj = metadata.as_object().cloned().unwrap_or_default();
                meta_obj.insert(
                    "healthcheck_results".to_string(),
                    serde_json::to_value(&updated).unwrap_or_default(),
                );
                meta_obj.insert(
                    "anomaly_score".to_string(),
                    serde_json::to_value(&score).unwrap_or_default(),
                );
                let updated_meta = serde_json::to_string(&meta_obj).ok();
                let _ = cred_repo::update_metadata(pool, &policy.credential_id, updated_meta.as_deref());

                // Apply remediation based on windowed score
                match score.remediation {
                    Remediation::Disable => {
                        let _ = rotation_repo::disable_policy(pool, &policy.id);
                        let _ = rotation_repo::record_rotation(
                            pool,
                            &policy.credential_id,
                            "anomaly",
                            "failed",
                            Some(&format!(
                                "Policy disabled: permanent failure rate {:.0}% over 1h ({} samples). Last: {}",
                                score.permanent_failure_rate_1h * 100.0,
                                score.sample_count,
                                msg
                            )),
                        );
                        tracing::error!(
                            credential_id = %policy.credential_id,
                            perm_rate_1h = %format!("{:.2}", score.permanent_failure_rate_1h),
                            sample_count = score.sample_count,
                            "Rotation: disabled — permanent failure rate {:.0}% exceeds threshold",
                            score.permanent_failure_rate_1h * 100.0
                        );
                    }
                    Remediation::RotateThenAlert => {
                        // Attempt rotation via rotate_now, record result
                        let _ = rotation_repo::record_rotation(
                            pool,
                            &policy.credential_id,
                            "anomaly",
                            "failed",
                            Some(&format!(
                                "Permanent errors detected (rate {:.0}%). Scheduling rotation attempt.",
                                score.permanent_failure_rate_1h * 100.0
                            )),
                        );
                        let _ = rotation_repo::schedule_failed_retry(pool, &policy.id, 1);
                        tracing::warn!(
                            credential_id = %policy.credential_id,
                            perm_rate_1h = %format!("{:.2}", score.permanent_failure_rate_1h),
                            "Rotation: permanent errors — scheduling rotation attempt"
                        );
                    }
                    Remediation::BackoffRetry => {
                        // Transient failures — exponential backoff
                        let consecutive = rotation_repo::get_consecutive_rotation_failures(
                            pool,
                            &policy.credential_id,
                        )
                        .unwrap_or(1);
                        let _ = rotation_repo::schedule_failed_retry(pool, &policy.id, consecutive);
                        tracing::warn!(
                            credential_id = %policy.credential_id,
                            transient_rate_1h = %format!("{:.2}", score.transient_failure_rate_1h),
                            "Rotation: transient failures — backoff retry scheduled"
                        );
                    }
                    Remediation::PreemptiveRotation => {
                        // Sustained degradation — try a pre-emptive rotation
                        let _ = rotation_repo::record_rotation(
                            pool,
                            &policy.credential_id,
                            "anomaly",
                            "failed",
                            Some(&format!(
                                "Sustained degradation: failure rate {:.0}% over 1h exceeds {:.0}% tolerance. Pre-emptive rotation scheduled.",
                                score.failure_rate_1h * 100.0,
                                tolerance * 100.0
                            )),
                        );
                        let _ = rotation_repo::schedule_failed_retry(pool, &policy.id, 1);
                        tracing::warn!(
                            credential_id = %policy.credential_id,
                            failure_rate_1h = %format!("{:.2}", score.failure_rate_1h),
                            "Rotation: sustained degradation — pre-emptive rotation"
                        );
                    }
                    Remediation::Healthy => {
                        // Occasional failure within tolerance — just retry normally
                        let consecutive = rotation_repo::get_consecutive_rotation_failures(
                            pool,
                            &policy.credential_id,
                        )
                        .unwrap_or(1);
                        let _ = rotation_repo::schedule_failed_retry(pool, &policy.id, consecutive);
                        tracing::warn!(
                            credential_id = %policy.credential_id,
                            failure_rate_1h = %format!("{:.2}", score.failure_rate_1h),
                            "Rotation: failed but within tolerance — retry scheduled"
                        );
                    }
                }
            }
        }
    }
}

/// Check for anomalies using windowed anomaly scoring.
///
/// For each credential, compute failure rates from the healthcheck ring buffer
/// and record anomalies based on temporal patterns rather than simple binary
/// state flips. Distinguishes transient issues (429, 503) from permanent
/// revocation (401, 403) and applies per-credential tolerance thresholds.
pub async fn detect_anomalies(pool: &DbPool) {
    let credentials = match cred_repo::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for cred in &credentials {
        let metadata: serde_json::Value = cred
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or(serde_json::Value::Null);

        let entries = parse_healthcheck_entries(&metadata);
        if entries.is_empty() {
            // No healthcheck data — fall back to legacy binary check
            let last_success = metadata
                .get("healthcheck_last_success")
                .and_then(|v| v.as_bool());

            if last_success == Some(false) {
                let had_previous = metadata
                    .get("healthcheck_last_success_at")
                    .and_then(|v| v.as_str())
                    .is_some();

                if had_previous {
                    let history = rotation_repo::get_history(pool, &cred.id, Some(1)).unwrap_or_default();
                    let already_recorded = history
                        .first()
                        .is_some_and(|h| h.rotation_type == "anomaly");

                    if !already_recorded {
                        let _ = rotation_repo::record_rotation(
                            pool,
                            &cred.id,
                            "anomaly",
                            "failed",
                            Some("Credential suddenly failing after previous success — possible revocation"),
                        );
                        tracing::warn!(
                            credential_id = %cred.id,
                            name = %cred.name,
                            "Rotation anomaly: credential failing after previous success (legacy detection)"
                        );
                    }
                }
            }
            continue;
        }

        // ── Windowed anomaly scoring ──
        let tolerance = resolve_tolerance(&metadata);
        let score = compute_anomaly_score(&entries, Some(tolerance));

        // Persist the computed score to metadata
        let mut meta_obj = metadata.as_object().cloned().unwrap_or_default();
        meta_obj.insert(
            "anomaly_score".to_string(),
            serde_json::to_value(&score).unwrap_or_default(),
        );
        let updated_meta = serde_json::to_string(&meta_obj).ok();
        let _ = cred_repo::update_metadata(pool, &cred.id, updated_meta.as_deref());

        // Skip stale data — windowed scores are unreliable if healthchecks are delayed
        if score.data_stale {
            tracing::debug!(
                credential_id = %cred.id,
                "Anomaly detection: skipping stale healthcheck window"
            );
            continue;
        }

        // Record anomaly based on windowed score
        let should_record = match score.remediation {
            Remediation::Disable | Remediation::RotateThenAlert => true,
            Remediation::PreemptiveRotation => score.failure_rate_1h > tolerance,
            _ => false,
        };

        if should_record {
            let history = rotation_repo::get_history(pool, &cred.id, Some(1)).unwrap_or_default();
            let already_recorded = history
                .first()
                .is_some_and(|h| h.rotation_type == "anomaly");

            if !already_recorded {
                let detail = format!(
                    "Windowed anomaly: failure_rate_1h={:.0}% (perm={:.0}%, trans={:.0}%), remediation={}, tolerance={:.0}%, samples={}",
                    score.failure_rate_1h * 100.0,
                    score.permanent_failure_rate_1h * 100.0,
                    score.transient_failure_rate_1h * 100.0,
                    score.remediation.as_str(),
                    tolerance * 100.0,
                    score.sample_count
                );
                let _ = rotation_repo::record_rotation(
                    pool,
                    &cred.id,
                    "anomaly",
                    "failed",
                    Some(&detail),
                );
                tracing::warn!(
                    credential_id = %cred.id,
                    name = %cred.name,
                    failure_rate_1h = %format!("{:.2}", score.failure_rate_1h),
                    remediation = %score.remediation.as_str(),
                    "Rotation anomaly detected via windowed scoring"
                );
            }
        }
    }
}

// OAuth/API-key rotation logic is now consolidated in connector strategies
// (see `connector_strategy.rs`). The default strategy trait impl delegates
// rotation to a healthcheck round-trip.

// ---------------------------------------------------------------------------
// Manual rotation trigger
// ---------------------------------------------------------------------------

/// Trigger an immediate rotation for a credential (manual or event-driven).
pub async fn rotate_now(
    pool: &DbPool,
    credential_id: &str,
    rotation_type: &str,
) -> Result<String, AppError> {
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    // Dispatch rotation through the connector strategy
    let strategy = connector_strategy::registry().get(&credential.service_type, None);
    let result = strategy.rotate(pool, &credential).await;

    match &result {
        Ok(detail) => {
            let _ = rotation_repo::record_rotation(
                pool,
                credential_id,
                rotation_type,
                "success",
                Some(detail),
            );
            // Update all enabled policies for this credential
            let policies = rotation_repo::get_policies_by_credential(pool, credential_id)
                .unwrap_or_default();
            for policy in &policies {
                if policy.enabled {
                    let _ = rotation_repo::mark_rotated(pool, &policy.id);
                }
            }
        }
        Err(e) => {
            let _ = rotation_repo::record_rotation(
                pool,
                credential_id,
                rotation_type,
                "failed",
                Some(&e.to_string()),
            );
        }
    }

    result
}

/// Get a summary of rotation status for a credential, including windowed anomaly score.
pub fn get_rotation_status(
    pool: &DbPool,
    credential_id: &str,
) -> Result<RotationStatus, AppError> {
    let policies = rotation_repo::get_policies_by_credential(pool, credential_id)?;
    let history = rotation_repo::get_history(pool, credential_id, Some(10))?;
    let credential = cred_repo::get_by_id(pool, credential_id)?;

    let active_policy = policies.iter().find(|p| p.enabled && p.policy_type == "scheduled");

    let next_rotation_at = active_policy.and_then(|p| p.next_rotation_at.clone());
    let last_rotated_at = active_policy.and_then(|p| p.last_rotated_at.clone());
    let rotation_interval_days = active_policy.map(|p| p.rotation_interval_days);
    let has_policy = !policies.is_empty();
    let policy_enabled = active_policy.is_some();

    let last_status = history.first().map(|h| h.status.clone());
    let anomaly_detected = history.iter().any(|h| h.rotation_type == "anomaly");
    let consecutive_failures =
        rotation_repo::get_consecutive_rotation_failures(pool, credential_id).unwrap_or(0);

    // Compute windowed anomaly score from healthcheck ring buffer
    let metadata: serde_json::Value = credential
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Null);

    let entries = parse_healthcheck_entries(&metadata);
    let tolerance = resolve_tolerance(&metadata);
    let anomaly_score = if entries.is_empty() {
        None
    } else {
        Some(compute_anomaly_score(&entries, Some(tolerance)))
    };

    Ok(RotationStatus {
        has_policy,
        policy_enabled,
        rotation_interval_days,
        next_rotation_at,
        last_rotated_at,
        last_status,
        anomaly_detected,
        consecutive_failures,
        recent_history: history,
        anomaly_score,
        anomaly_tolerance: tolerance,
    })
}

#[derive(Debug, serde::Serialize)]
pub struct RotationStatus {
    pub has_policy: bool,
    pub policy_enabled: bool,
    pub rotation_interval_days: Option<i32>,
    pub next_rotation_at: Option<String>,
    pub last_rotated_at: Option<String>,
    pub last_status: Option<String>,
    pub anomaly_detected: bool,
    pub consecutive_failures: u32,
    pub recent_history: Vec<crate::db::models::CredentialRotationEntry>,
    pub anomaly_score: Option<AnomalyScore>,
    pub anomaly_tolerance: f64,
}

// ---------------------------------------------------------------------------
// Event-driven rotation evaluation
// ---------------------------------------------------------------------------

/// Evaluate all enabled credential events and trigger rotations as needed.
/// Called periodically from the RotationSubscription alongside scheduled policies.
///
/// Supported event_template_id types:
/// - `cron_schedule`: fires rotation when the cron expression matches
/// - `expiration_threshold`: fires when credential approaches expiry
/// - `healthcheck_failure`: fires rotation when the credential's healthcheck fails
pub async fn evaluate_credential_events(pool: &DbPool) {
    let events = match cred_repo::get_enabled_events(pool) {
        Ok(e) => e,
        Err(e) => {
            tracing::error!("Credential events: failed to query enabled events: {}", e);
            return;
        }
    };

    if events.is_empty() {
        return;
    }

    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();

    for event in &events {
        let config = parse_event_config(event.config.as_deref());

        let should_fire = match event.event_template_id.as_str() {
            "cron_schedule" => evaluate_cron_event(&config, &now, event.last_polled_at.as_deref()),
            "expiration_threshold" => evaluate_expiration_event(pool, &event.credential_id, &config, &now),
            "healthcheck_failure" => evaluate_healthcheck_event(pool, &event.credential_id).await,
            other => {
                tracing::debug!(
                    event_id = %event.id,
                    template = %other,
                    "Credential events: unknown event template, skipping"
                );
                false
            }
        };

        if should_fire {
            tracing::info!(
                credential_id = %event.credential_id,
                event_id = %event.id,
                event_type = %event.event_template_id,
                "Credential events: event triggered, initiating rotation"
            );

            match rotate_now(pool, &event.credential_id, &format!("event:{}", event.event_template_id)).await {
                Ok(detail) => {
                    tracing::info!(
                        credential_id = %event.credential_id,
                        "Credential events: rotation successful — {}",
                        detail
                    );
                }
                Err(e) => {
                    tracing::warn!(
                        credential_id = %event.credential_id,
                        error = %e,
                        "Credential events: rotation failed"
                    );
                }
            }
        }

        // Update last_polled_at so we know when this event was last evaluated
        let _ = cred_repo::update_event(
            pool,
            &event.id,
            crate::db::models::UpdateCredentialEventInput {
                last_polled_at: Some(now_str.clone()),
                ..Default::default()
            },
        );
    }
}

/// Check if a cron schedule matches the current time window since last poll.
fn evaluate_cron_event(
    config: &serde_json::Value,
    now: &chrono::DateTime<chrono::Utc>,
    last_polled_at: Option<&str>,
) -> bool {
    let cron_expr = match config.get("cronExpression").and_then(|v| v.as_str()) {
        Some(expr) if !expr.trim().is_empty() => expr.trim(),
        _ => return false,
    };

    let schedule = match cron::parse_cron(cron_expr) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(cron = %cron_expr, error = %e, "Credential events: invalid cron expression");
            return false;
        }
    };

    // Determine the reference time: last poll or 60s ago (first run)
    let from = last_polled_at
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc))
        .unwrap_or_else(|| *now - chrono::Duration::seconds(60));

    // If the next fire time after last poll falls within (from, now], trigger
    match cron::next_fire_time(&schedule, from) {
        Some(next) => next <= *now,
        None => false,
    }
}

/// Check if a credential is approaching its configured expiration threshold.
fn evaluate_expiration_event(
    pool: &DbPool,
    credential_id: &str,
    config: &serde_json::Value,
    now: &chrono::DateTime<chrono::Utc>,
) -> bool {
    let threshold_days = config
        .get("thresholdDays")
        .and_then(|v| v.as_i64())
        .unwrap_or(7);

    // Check if the credential has an expires_at in its metadata
    let credential = match cred_repo::get_by_id(pool, credential_id) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let metadata: serde_json::Value = credential
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Null);

    let expires_at = metadata
        .get("expires_at")
        .or_else(|| metadata.get("expiresAt"))
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&chrono::Utc));

    match expires_at {
        Some(exp) => {
            let threshold = *now + chrono::Duration::days(threshold_days);
            // Fire if the credential expires within the threshold window
            exp <= threshold && exp > *now
        }
        None => false,
    }
}

/// Check if a credential's healthcheck is currently failing, using windowed
/// anomaly scoring when ring buffer data is available.
async fn evaluate_healthcheck_event(
    pool: &DbPool,
    credential_id: &str,
) -> bool {
    let credential = match cred_repo::get_by_id(pool, credential_id) {
        Ok(c) => c,
        Err(_) => return false,
    };

    let metadata: serde_json::Value = credential
        .metadata
        .as_deref()
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Null);

    // If we have ring buffer data, use windowed scoring
    let entries = parse_healthcheck_entries(&metadata);
    if !entries.is_empty() {
        let tolerance = resolve_tolerance(&metadata);
        let score = compute_anomaly_score(&entries, Some(tolerance));

        // Only trigger rotation for actionable remediations
        return matches!(
            score.remediation,
            Remediation::RotateThenAlert | Remediation::PreemptiveRotation | Remediation::Disable
        );
    }

    // Legacy fallback: binary healthcheck status
    let last_success = metadata
        .get("healthcheck_last_success")
        .and_then(|v| v.as_bool());

    if last_success != Some(false) {
        return false;
    }

    let had_previous_success = metadata
        .get("healthcheck_last_success_at")
        .and_then(|v| v.as_str())
        .is_some();

    had_previous_success
}

fn parse_event_config(config: Option<&str>) -> serde_json::Value {
    config
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(serde_json::Value::Object(serde_json::Map::new()))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// `has_refresh_token` logic is now handled by each strategy's `is_oauth()` method.
