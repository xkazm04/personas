use serde::Serialize;

/// App-wide error type. Every fallible function returns `Result<T, AppError>`.
/// Serializes cleanly for Tauri IPC so the frontend gets structured error messages.
#[derive(Debug, thiserror::Error)]
#[allow(dead_code)] // Variants used by Tauri commands in Phase 3
pub enum AppError {
    #[error("Database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("Connection pool error: {0}")]
    Pool(#[from] r2d2::Error),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Execution error: {0}")]
    Execution(String),

    #[error("Process spawn error: {0}")]
    ProcessSpawn(String),

    #[error("Authentication error: {0}")]
    Auth(String),

    #[error("Network offline: {0}")]
    NetworkOffline(String),

    #[error("Cloud error: {0}")]
    Cloud(String),

    #[error("GitLab error: {0}")]
    GitLab(String),

    #[error("Rate limited: {0}")]
    RateLimited(String),

    #[error("Forbidden: {0}")]
    Forbidden(String),

    #[error("OAuth grant revoked: {0}")]
    OAuthRevoked(String),

    #[error("Retry exhausted: {0}")]
    RetryExhausted(String),

    #[error("Identity keyring lost: {0}")]
    KeyringLost(String),

    /// An MCP / external tool requires fresh OAuth authorization before it can
    /// be invoked. The `authorize_url` should be opened in a browser so the
    /// user can grant consent; after the grant the caller should retry the
    /// original invocation.
    ///
    /// Added 2026-04-08 as part of the LangSmith/Arcade MCP gateway pattern.
    /// This is a structured, non-fatal error — the frontend surfaces it via
    /// `PendingAuthModal` rather than a generic error toast. The extra
    /// per-variant data (credential_id, tool_name, authorize_url) is
    /// serialized as a `details` object on the error payload (see the
    /// `Serialize` impl below).
    #[error("Authorization required for tool '{tool_name}' on credential '{credential_id}' — open {authorize_url} to grant consent")]
    AuthorizationRequired {
        credential_id: String,
        tool_name: String,
        authorize_url: String,
    },

    #[error("{0}")]
    Internal(String),

    #[error("{0}")]
    External(String),
}

/// Sanitize error messages to avoid leaking internal file paths or system details
/// to the frontend. Keeps the human-readable portion but strips OS-level detail.
fn sanitize_error_message(msg: &str) -> String {
    // Strip absolute file paths (Unix and Windows)
    // Regex compiled once via OnceLock to avoid per-call overhead.
    static RE_PATH: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE_PATH.get_or_init(|| {
        regex::Regex::new(r#"(?:[A-Z]:\\|/(?:tmp|var|home|Users|C:))[^\s'":,]+"#)
            .expect("sanitize_error_message regex is valid")
    });
    re.replace_all(msg, "<path>").into_owned()
}

/// Tauri requires `Serialize` on command return errors.
/// We serialize as `{ error: "...", kind: "..." }` for frontend consumption.
/// The `AuthorizationRequired` variant additionally emits a `details` object
/// carrying `credential_id`, `tool_name`, and `authorize_url` so the frontend
/// modal can drive the consent flow without parsing the error message.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        // AuthorizationRequired carries structured metadata the frontend needs;
        // every other variant uses the standard 2-field payload.
        let has_details = matches!(self, AppError::AuthorizationRequired { .. });
        let mut s = serializer.serialize_struct("AppError", if has_details { 3 } else { 2 })?;
        // Sanitize error messages to prevent leaking file paths to frontend
        let message = match self {
            AppError::Database(_) | AppError::Io(_) | AppError::Internal(_) => {
                sanitize_error_message(&self.to_string())
            }
            _ => self.to_string(),
        };
        s.serialize_field("error", &message)?;
        s.serialize_field(
            "kind",
            match self {
                AppError::Database(_) => "database",
                AppError::Pool(_) => "pool",
                AppError::NotFound(_) => "not_found",
                AppError::Validation(_) => "validation",
                AppError::Io(_) => "io",
                AppError::Serde(_) => "serde",
                AppError::Execution(_) => "execution",
                AppError::ProcessSpawn(_) => "process_spawn",
                AppError::Auth(_) => "auth",
                AppError::NetworkOffline(_) => "network_offline",
                AppError::Cloud(_) => "cloud",
                AppError::GitLab(_) => "gitlab",
                AppError::RateLimited(_) => "rate_limited",
                AppError::Forbidden(_) => "forbidden",
                AppError::OAuthRevoked(_) => "oauth_revoked",
                AppError::RetryExhausted(_) => "retry_exhausted",
                AppError::KeyringLost(_) => "keyring_lost",
                AppError::AuthorizationRequired { .. } => "authorization_required",
                AppError::Internal(_) => "internal",
                AppError::External(_) => "external",
            },
        )?;
        if let AppError::AuthorizationRequired { credential_id, tool_name, authorize_url } = self {
            let details = serde_json::json!({
                "credential_id": credential_id,
                "tool_name": tool_name,
                "authorize_url": authorize_url,
            });
            s.serialize_field("details", &details)?;
        }
        s.end()
    }
}
