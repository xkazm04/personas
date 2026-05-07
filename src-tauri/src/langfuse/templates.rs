//! Compose + .env templates for the managed Langfuse stack.
//!
//! The compose file is embedded as a static string and never modified at
//! runtime. All dynamic values (secrets, ports, init credentials) live in
//! the .env file that sits next to it. Both files are written under
//! `<app_data_dir>/langfuse/`.
//!
//! Compose project name is `personas-langfuse` so volumes and networks are
//! isolated from any other Docker projects on the user's machine.

use rand::{rngs::OsRng, RngCore};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

/// Compose project name. Used as both the Docker compose `--project-name`
/// flag and the prefix for volumes/networks. Don't change without a
/// migration plan for existing users.
pub const PROJECT_NAME: &str = "personas-langfuse";

/// Default port the langfuse-web service binds to on the host when the user
/// hasn't expressed a preference. The actual port at runtime may differ — see
/// [`pick_free_port`].
pub const DEFAULT_PORT: u16 = 3000;

/// How many ports to try when scanning upward from the user's preferred port
/// before giving up.
pub const PORT_SCAN_LIMIT: u16 = 10;

/// File names within the stack directory.
pub const COMPOSE_FILE: &str = "docker-compose.yml";
pub const ENV_FILE: &str = ".env";

/// Embedded compose for the Langfuse v3 stack.
///
/// Differences from Langfuse's upstream compose:
/// - Auxiliary services (postgres, clickhouse, redis, minio) do NOT publish
///   ports to the host — only langfuse-web is reachable. This minimizes
///   port-conflict risk on developer machines that already run Postgres etc.
/// - The langfuse-worker service has no ports either (its prometheus port is
///   not needed for our purposes).
/// - The web service binds on `127.0.0.1:${LANGFUSE_PORT}:3000` so it's not
///   exposed beyond the loopback interface.
/// - Telemetry to Langfuse Cloud is disabled by default.
const COMPOSE_TEMPLATE: &str = include_str!("compose.yml.tmpl");

/// Names of every env var the .env file must define for the compose to be
/// fully wired. Used by the loader to detect a partially-written .env.
const REQUIRED_ENV_KEYS: &[&str] = &[
    "LANGFUSE_PORT",
    "POSTGRES_PASSWORD",
    "CLICKHOUSE_PASSWORD",
    "REDIS_AUTH",
    "MINIO_ROOT_PASSWORD",
    "NEXTAUTH_SECRET",
    "SALT",
    "ENCRYPTION_KEY",
    "LANGFUSE_INIT_PROJECT_PUBLIC_KEY",
    "LANGFUSE_INIT_PROJECT_SECRET_KEY",
    "LANGFUSE_INIT_USER_EMAIL",
    "LANGFUSE_INIT_USER_PASSWORD",
];

/// All values needed to render a fresh .env file. `host_url` is precomputed
/// so the keyring write path doesn't have to reassemble it.
#[derive(Debug, Clone)]
pub struct StackSecrets {
    pub port: u16,
    pub host_url: String,
    pub postgres_password: String,
    pub clickhouse_password: String,
    pub redis_auth: String,
    pub minio_root_password: String,
    pub nextauth_secret: String,
    pub salt: String,
    pub encryption_key: String,
    pub init_public_key: String,
    pub init_secret_key: String,
    pub init_user_email: String,
    pub init_user_password: String,
}

impl StackSecrets {
    /// Generate a fresh set of secrets for first-time stack init.
    pub fn generate(port: u16) -> Self {
        Self {
            port,
            host_url: format!("http://localhost:{port}"),
            postgres_password: random_hex(16),
            clickhouse_password: random_hex(16),
            redis_auth: random_hex(16),
            minio_root_password: random_hex(16),
            nextauth_secret: random_hex(32),
            salt: random_hex(32),
            // ENCRYPTION_KEY MUST be exactly 64 hex characters per Langfuse docs.
            encryption_key: random_hex(32),
            init_public_key: format!("pk-lf-{}", random_hex(16)),
            init_secret_key: format!("sk-lf-{}", random_hex(16)),
            // Langfuse validates `LANGFUSE_INIT_USER_EMAIL` with Zod's
            // `.email()` which rejects bare-`@localhost` (no TLD). `local.host`
            // is a valid email format and reads as "this is local-only".
            init_user_email: "personas@local.host".to_string(),
            init_user_password: random_alnum(16),
        }
    }
}

/// Resolve `<app_data_dir>/langfuse/`. Caller is responsible for
/// `fs::create_dir_all` if it doesn't exist.
pub fn stack_dir(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("langfuse")
}

/// Returns true if both compose and env files exist on disk.
pub fn is_initialized(app_data_dir: &Path) -> bool {
    let dir = stack_dir(app_data_dir);
    dir.join(COMPOSE_FILE).is_file() && dir.join(ENV_FILE).is_file()
}

/// Write the compose file (always overwrites — it's the authority) and the
/// .env file (only if missing — preserves user edits and keeps generated
/// secrets stable across upgrades). Returns the secrets that were written
/// (newly generated on first init, parsed back from disk on subsequent calls).
///
/// `preferred_port` is consulted only on first init. Subsequent calls return
/// whatever port is already pinned in the on-disk .env; use [`update_port`]
/// to realign the port without rewriting other secrets.
pub fn ensure_files(app_data_dir: &Path, preferred_port: u16) -> Result<StackSecrets, AppError> {
    let dir = stack_dir(app_data_dir);
    fs::create_dir_all(&dir).map_err(AppError::Io)?;

    let compose_path = dir.join(COMPOSE_FILE);
    fs::write(&compose_path, COMPOSE_TEMPLATE).map_err(AppError::Io)?;

    let env_path = dir.join(ENV_FILE);
    if env_path.is_file() {
        return read_env(&env_path);
    }

    let port = pick_free_port(preferred_port)?;
    let secrets = StackSecrets::generate(port);
    fs::write(&env_path, render_env(&secrets)).map_err(AppError::Io)?;
    Ok(secrets)
}

/// Update only the port in the on-disk .env, preserving every other secret.
/// Used when the user changes their preferred port between starts.
pub fn update_port(app_data_dir: &Path, new_port: u16) -> Result<StackSecrets, AppError> {
    let dir = stack_dir(app_data_dir);
    let env_path = dir.join(ENV_FILE);
    let mut secrets = read_env(&env_path)?;
    secrets.port = new_port;
    secrets.host_url = format!("http://localhost:{new_port}");
    fs::write(&env_path, render_env(&secrets)).map_err(AppError::Io)?;
    Ok(secrets)
}

/// Find the first free TCP port at-or-above `preferred`, scanning up to
/// `PORT_SCAN_LIMIT` ports. Returns an error if every port in the range is
/// busy — caller can surface a "pick a different preferred port" message.
pub fn pick_free_port(preferred: u16) -> Result<u16, AppError> {
    use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};

    let starting = if preferred == 0 { DEFAULT_PORT } else { preferred };
    for offset in 0..PORT_SCAN_LIMIT {
        let port = starting.saturating_add(offset);
        if port == 0 {
            continue;
        }
        if TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).is_ok() {
            return Ok(port);
        }
    }
    Err(AppError::Langfuse(format!(
        "Could not find a free port near {starting}. Pick a different preferred port in the plugin settings."
    )))
}

/// Read the .env file back into a `StackSecrets`. Used after the first init
/// so the saved keys can be re-pushed into the keyring (idempotent saves).
pub fn read_env(env_path: &Path) -> Result<StackSecrets, AppError> {
    let contents = fs::read_to_string(env_path).map_err(AppError::Io)?;
    let mut map = std::collections::HashMap::new();
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            map.insert(k.trim().to_string(), v.trim().to_string());
        }
    }

    for key in REQUIRED_ENV_KEYS {
        if !map.contains_key(*key) {
            return Err(AppError::Langfuse(format!(
                ".env at {} is missing key {key}",
                env_path.display()
            )));
        }
    }

    let port: u16 = map["LANGFUSE_PORT"]
        .parse()
        .map_err(|e| AppError::Langfuse(format!("Invalid LANGFUSE_PORT: {e}")))?;

    Ok(StackSecrets {
        port,
        host_url: format!("http://localhost:{port}"),
        postgres_password: map["POSTGRES_PASSWORD"].clone(),
        clickhouse_password: map["CLICKHOUSE_PASSWORD"].clone(),
        redis_auth: map["REDIS_AUTH"].clone(),
        minio_root_password: map["MINIO_ROOT_PASSWORD"].clone(),
        nextauth_secret: map["NEXTAUTH_SECRET"].clone(),
        salt: map["SALT"].clone(),
        encryption_key: map["ENCRYPTION_KEY"].clone(),
        init_public_key: map["LANGFUSE_INIT_PROJECT_PUBLIC_KEY"].clone(),
        init_secret_key: map["LANGFUSE_INIT_PROJECT_SECRET_KEY"].clone(),
        init_user_email: map["LANGFUSE_INIT_USER_EMAIL"].clone(),
        init_user_password: map["LANGFUSE_INIT_USER_PASSWORD"].clone(),
    })
}

fn render_env(s: &StackSecrets) -> String {
    format!(
        "# Generated by Personas. Restart the stack to apply edits.\n\
         LANGFUSE_PORT={port}\n\
         POSTGRES_PASSWORD={pg}\n\
         CLICKHOUSE_PASSWORD={ch}\n\
         REDIS_AUTH={redis}\n\
         MINIO_ROOT_PASSWORD={minio}\n\
         NEXTAUTH_SECRET={nextauth}\n\
         SALT={salt}\n\
         ENCRYPTION_KEY={enc}\n\
         LANGFUSE_INIT_PROJECT_PUBLIC_KEY={pk}\n\
         LANGFUSE_INIT_PROJECT_SECRET_KEY={sk}\n\
         LANGFUSE_INIT_USER_EMAIL={email}\n\
         LANGFUSE_INIT_USER_PASSWORD={pw}\n",
        port = s.port,
        pg = s.postgres_password,
        ch = s.clickhouse_password,
        redis = s.redis_auth,
        minio = s.minio_root_password,
        nextauth = s.nextauth_secret,
        salt = s.salt,
        enc = s.encryption_key,
        pk = s.init_public_key,
        sk = s.init_secret_key,
        email = s.init_user_email,
        pw = s.init_user_password,
    )
}

fn random_hex(byte_len: usize) -> String {
    let mut buf = vec![0u8; byte_len];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

fn random_alnum(len: usize) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let mut buf = vec![0u8; len];
    OsRng.fill_bytes(&mut buf);
    buf.iter()
        .map(|b| ALPHABET[*b as usize % ALPHABET.len()] as char)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_secrets_have_expected_shapes() {
        let s = StackSecrets::generate(3000);
        assert!(s.init_public_key.starts_with("pk-lf-"));
        assert!(s.init_secret_key.starts_with("sk-lf-"));
        assert_eq!(s.encryption_key.len(), 64);
        assert_eq!(s.salt.len(), 64);
        assert_eq!(s.nextauth_secret.len(), 64);
        assert_eq!(s.init_user_password.len(), 16);
        assert_eq!(s.host_url, "http://localhost:3000");
    }

    #[test]
    fn env_round_trips() {
        let original = StackSecrets::generate(3000);
        let rendered = render_env(&original);
        // Write to a temp file and read back
        let tmp = std::env::temp_dir().join(format!(
            "langfuse-test-env-{}",
            random_alnum(8)
        ));
        std::fs::write(&tmp, rendered).unwrap();
        let parsed = read_env(&tmp).unwrap();
        std::fs::remove_file(&tmp).ok();
        assert_eq!(parsed.port, original.port);
        assert_eq!(parsed.encryption_key, original.encryption_key);
        assert_eq!(parsed.init_public_key, original.init_public_key);
        assert_eq!(parsed.init_user_password, original.init_user_password);
    }
}
