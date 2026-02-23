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

    #[error("{0}")]
    Internal(String),
}

/// Tauri requires `Serialize` on command return errors.
/// We serialize as `{ error: "...", kind: "..." }` for frontend consumption.
impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("AppError", 2)?;
        s.serialize_field("error", &self.to_string())?;
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
                AppError::Internal(_) => "internal",
            },
        )?;
        s.end()
    }
}
