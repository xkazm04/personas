//! Autonomous Credential Foraging Agent.
//!
//! Scans the local filesystem (~/.aws, ~/.kube, env vars, .env files, etc.)
//! to proactively discover credentials the user already has configured.
//! Returns a list of discovered credential sources that the user can
//! selectively import into the vault.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::ipc_auth::require_privileged_sync;
use crate::AppState;

// -- Types --------------------------------------------------------------

/// A single discovered credential source on the filesystem.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForagedCredential {
    /// Unique key for this discovery (e.g. "aws:profile:default").
    pub id: String,
    /// Human-readable label.
    pub label: String,
    /// Service type matching a connector (e.g. "aws", "github", "openai").
    pub service_type: String,
    /// Where the credential was found.
    pub source: ForageSource,
    /// Discovered field values (keys may be masked for display).
    pub fields: HashMap<String, String>,
    /// Whether this credential already exists in the vault.
    pub already_imported: bool,
    /// Confidence level for the match.
    pub confidence: ForageConfidence,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForageSource {
    AwsCredentials,
    AwsConfig,
    KubeConfig,
    EnvVar,
    DotEnv,
    Npmrc,
    DockerConfig,
    GitHubCli,
    SshKey,
    GitConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForageConfidence {
    High,
    Medium,
    Low,
}

#[derive(Debug, Serialize)]
pub struct ForagingScanResult {
    pub credentials: Vec<ForagedCredential>,
    pub scanned_sources: Vec<String>,
    pub scan_duration_ms: u64,
}

// -- Known env-var patterns ---------------------------------------------

/// Map of environment variable names -> (service_type, field_key).
const ENV_PATTERNS: &[(&str, &str, &str)] = &[
    ("OPENAI_API_KEY", "openai", "api_key"),
    ("ANTHROPIC_API_KEY", "anthropic", "api_key"),
    ("GITHUB_TOKEN", "github", "api_key"),
    ("GITHUB_PERSONAL_ACCESS_TOKEN", "github", "api_key"),
    ("GH_TOKEN", "github", "api_key"),
    ("SLACK_BOT_TOKEN", "slack", "bot_token"),
    ("SLACK_TOKEN", "slack", "bot_token"),
    ("DISCORD_BOT_TOKEN", "discord", "bot_token"),
    ("DISCORD_TOKEN", "discord", "bot_token"),
    ("SENDGRID_API_KEY", "sendgrid", "api_key"),
    ("RESEND_API_KEY", "resend", "api_key"),
    ("SENTRY_DSN", "sentry", "dsn"),
    ("SENTRY_AUTH_TOKEN", "sentry", "auth_token"),
    ("SUPABASE_URL", "supabase", "project_url"),
    ("SUPABASE_KEY", "supabase", "api_key"),
    ("SUPABASE_ANON_KEY", "supabase", "api_key"),
    ("SUPABASE_SERVICE_ROLE_KEY", "supabase", "service_role_key"),
    ("VERCEL_TOKEN", "vercel", "api_token"),
    ("NETLIFY_AUTH_TOKEN", "netlify", "access_token"),
    ("CLOUDFLARE_API_TOKEN", "cloudflare", "api_token"),
    ("CF_API_TOKEN", "cloudflare", "api_token"),
    ("LINEAR_API_KEY", "linear", "api_key"),
    ("POSTHOG_API_KEY", "posthog", "api_key"),
    ("MIXPANEL_TOKEN", "mixpanel", "project_token"),
    ("NEON_API_KEY", "neon", "api_key"),
    ("UPSTASH_REDIS_REST_TOKEN", "upstash", "rest_token"),
    ("UPSTASH_REDIS_REST_URL", "upstash", "rest_url"),
    ("HUBSPOT_ACCESS_TOKEN", "hubspot", "access_token"),
    ("JIRA_API_TOKEN", "jira", "api_token"),
    ("CONFLUENCE_API_TOKEN", "confluence", "api_token"),
    ("CLICKUP_API_TOKEN", "clickup", "api_token"),
    ("CIRCLECI_TOKEN", "circleci", "api_token"),
    ("TELEGRAM_BOT_TOKEN", "telegram", "bot_token"),
    ("TWILIO_ACCOUNT_SID", "twilio-sms", "account_sid"),
    ("TWILIO_AUTH_TOKEN", "twilio-sms", "auth_token"),
    ("AIRTABLE_API_KEY", "airtable", "api_key"),
    ("AIRTABLE_PERSONAL_ACCESS_TOKEN", "airtable", "api_key"),
    ("NOTION_TOKEN", "notion", "api_key"),
    ("NOTION_API_KEY", "notion", "api_key"),
    ("FIGMA_ACCESS_TOKEN", "figma", "access_token"),
    ("PLANETSCALE_TOKEN", "planetscale", "service_token"),
    ("AWS_ACCESS_KEY_ID", "aws", "access_key_id"),
    ("AWS_SECRET_ACCESS_KEY", "aws", "secret_access_key"),
    ("BUFFER_ACCESS_TOKEN", "buffer", "access_token"),
    ("MONDAY_API_TOKEN", "monday", "api_token"),
    ("CALENDLY_PERSONAL_TOKEN", "calendly", "personal_access_token"),
    ("DROPBOX_ACCESS_TOKEN", "dropbox", "access_token"),
    ("CONVEX_DEPLOY_KEY", "convex", "deploy_key"),
    ("BETTERSTACK_API_TOKEN", "betterstack", "api_token"),
    ("REDIS_URL", "redis", "connection_string"),
    ("DATABASE_URL", "postgres", "connection_string"),
    ("POSTGRES_URL", "postgres", "connection_string"),
    ("MONGODB_URI", "mongodb", "connection_string"),
    ("MONGO_URL", "mongodb", "connection_string"),
];

// -- Scanning logic -----------------------------------------------------

fn home_dir() -> Option<PathBuf> {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .ok()
        .map(PathBuf::from)
}

/// Mask a credential value for safe display (show first 4 and last 4 chars).
fn mask_value(val: &str) -> String {
    let char_count = val.chars().count();
    if char_count <= 12 {
        return "*".repeat(char_count.min(8));
    }
    let prefix: String = val.chars().take(4).collect();
    let suffix: String = val.chars().skip(char_count - 4).collect();
    format!("{}...{}", prefix, suffix)
}

/// Scan environment variables for known credential patterns.
///
/// Values are masked immediately on read — raw secrets are never accumulated
/// in intermediate collections, preventing plaintext exposure in memory dumps.
fn scan_env_vars() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    // Group already-masked display values by service_type.
    let mut masked_fields: HashMap<String, HashMap<String, String>> = HashMap::new();
    let mut service_vars: HashMap<String, Vec<String>> = HashMap::new();

    for &(env_key, service_type, field_key) in ENV_PATTERNS {
        if let Ok(value) = std::env::var(env_key) {
            if value.is_empty() {
                continue;
            }
            // Mask immediately — the raw value is dropped at the end of this
            // scope and never stored in any collection.
            let masked = mask_value(&value);
            // `value` (the plain String) is dropped here.

            masked_fields
                .entry(service_type.to_string())
                .or_default()
                .insert(field_key.to_string(), masked);
            service_vars
                .entry(service_type.to_string())
                .or_default()
                .push(env_key.to_string());
        }
    }

    for (service_type, display_fields) in masked_fields {
        let var_names = service_vars.get(&service_type).cloned().unwrap_or_default();
        let label_suffix = if var_names.len() == 1 {
            format!(" ({})", var_names[0])
        } else {
            format!(" ({} vars)", var_names.len())
        };

        results.push(ForagedCredential {
            id: format!("env:{service_type}"),
            label: format!("{service_type}{label_suffix}"),
            service_type: service_type.clone(),
            source: ForageSource::EnvVar,
            fields: display_fields,
            already_imported: false,
            confidence: ForageConfidence::High,
        });
    }

    results
}

/// Scan ~/.aws/credentials for AWS profiles.
///
/// Values are masked immediately on parse — raw secrets are never stored.
fn scan_aws_credentials() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let path = home.join(".aws").join("credentials");

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return results,
    };

    let mut current_profile: Option<String> = None;
    // Store already-masked values only.
    let mut current_masked_fields: HashMap<String, String> = HashMap::new();

    let flush = |profile: &str, masked_fields: &HashMap<String, String>, out: &mut Vec<ForagedCredential>| {
        if masked_fields.is_empty() {
            return;
        }
        out.push(ForagedCredential {
            id: format!("aws:profile:{profile}"),
            label: format!("AWS -- {profile}"),
            service_type: "aws".to_string(),
            source: ForageSource::AwsCredentials,
            fields: masked_fields.clone(),
            already_imported: false,
            confidence: ForageConfidence::High,
        });
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('[') && trimmed.ends_with(']') {
            // Flush previous profile
            if let Some(ref profile) = current_profile {
                flush(profile, &current_masked_fields, &mut results);
            }
            current_profile = Some(trimmed[1..trimmed.len() - 1].to_string());
            current_masked_fields.clear();
        } else if let Some(eq_pos) = trimmed.find('=') {
            let key = trimmed[..eq_pos].trim().to_string();
            let val = trimmed[eq_pos + 1..].trim();
            if !val.is_empty() {
                // Mask immediately — raw value is never stored.
                current_masked_fields.insert(key, mask_value(val));
            }
        }
    }
    // Flush last profile
    if let Some(ref profile) = current_profile {
        flush(profile, &current_masked_fields, &mut results);
    }

    results
}

/// Scan ~/.kube/config for Kubernetes contexts.
fn scan_kube_config() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let path = home.join(".kube").join("config");

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return results,
    };

    // Simple YAML context extraction -- look for `- name:` under `contexts:`
    let mut in_contexts = false;
    let mut context_names = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == "contexts:" {
            in_contexts = true;
            continue;
        }
        if in_contexts {
            if !line.starts_with(' ') && !line.starts_with('\t') && !trimmed.is_empty() {
                break; // Left the contexts block
            }
            if trimmed.starts_with("- name:") {
                let name = trimmed.trim_start_matches("- name:").trim().trim_matches('"');
                context_names.push(name.to_string());
            }
        }
    }

    for name in context_names {
        let mut fields = HashMap::new();
        fields.insert("context".to_string(), name.clone());
        results.push(ForagedCredential {
            id: format!("kube:context:{name}"),
            label: format!("Kubernetes -- {name}"),
            service_type: "kubernetes".to_string(),
            source: ForageSource::KubeConfig,
            fields,
            already_imported: false,
            confidence: ForageConfidence::Medium,
        });
    }

    results
}

/// Scan .env files in common project locations.
fn scan_dotenv_files() -> Vec<ForagedCredential> {
    let mut results = Vec::new();

    // Check current working directory
    let cwd_env = PathBuf::from(".env");
    if let Ok(content) = std::fs::read_to_string(&cwd_env) {
        results.extend(parse_dotenv_content(&content, ".env (cwd)"));
    }

    // Also check ~/.env if it exists
    if let Some(home) = home_dir() {
        let home_env = home.join(".env");
        if let Ok(content) = std::fs::read_to_string(&home_env) {
            results.extend(parse_dotenv_content(&content, "~/.env"));
        }
    }

    results
}

fn parse_dotenv_content(content: &str, source_label: &str) -> Vec<ForagedCredential> {
    let mut results = Vec::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some(eq_pos) = trimmed.find('=') else { continue };
        let key = trimmed[..eq_pos].trim();
        let val = trimmed[eq_pos + 1..].trim().trim_matches('"').trim_matches('\'');
        if val.is_empty() {
            continue;
        }

        // Match against known patterns
        for &(env_key, service_type, field_key) in ENV_PATTERNS {
            if key == env_key {
                let mut fields = HashMap::new();
                fields.insert(field_key.to_string(), mask_value(val));

                results.push(ForagedCredential {
                    id: format!("dotenv:{source_label}:{key}"),
                    label: format!("{service_type} from {source_label}"),
                    service_type: service_type.to_string(),
                    source: ForageSource::DotEnv,
                    fields,
                    already_imported: false,
                    confidence: ForageConfidence::High,
                });
                break;
            }
        }
    }

    results
}

/// Scan ~/.npmrc for auth tokens.
fn scan_npmrc() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let path = home.join(".npmrc");

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return results,
    };

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.contains("_authToken=") || trimmed.contains("_auth=") {
            let mut fields = HashMap::new();
            fields.insert("token".to_string(), mask_value(trimmed));
            results.push(ForagedCredential {
                id: "npmrc:token".to_string(),
                label: "npm Registry Token".to_string(),
                service_type: "npm".to_string(),
                source: ForageSource::Npmrc,
                fields,
                already_imported: false,
                confidence: ForageConfidence::Medium,
            });
            break; // Only report once
        }
    }

    results
}

/// Scan ~/.docker/config.json for registry credentials.
fn scan_docker_config() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let path = home.join(".docker").join("config.json");

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => return results,
    };

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
        if let Some(auths) = json.get("auths").and_then(|a| a.as_object()) {
            for (registry, _auth) in auths {
                let mut fields = HashMap::new();
                fields.insert("registry".to_string(), registry.clone());
                results.push(ForagedCredential {
                    id: format!("docker:registry:{registry}"),
                    label: format!("Docker -- {registry}"),
                    service_type: "docker".to_string(),
                    source: ForageSource::DockerConfig,
                    fields,
                    already_imported: false,
                    confidence: ForageConfidence::Medium,
                });
            }
        }
    }

    results
}

/// Scan ~/.config/gh/hosts.yml for GitHub CLI tokens.
fn scan_github_cli() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let path = home.join(".config").join("gh").join("hosts.yml");

    // On Windows, also check AppData
    let win_path = home.join("AppData").join("Roaming").join("GitHub CLI").join("hosts.yml");

    let content = match std::fs::read_to_string(&path) {
        Ok(c) => c,
        Err(_) => match std::fs::read_to_string(&win_path) {
            Ok(c) => c,
            Err(_) => return results,
        },
    };

    // Simple YAML: look for "oauth_token:" lines
    let mut current_host: Option<String> = None;
    for line in content.lines() {
        let trimmed = line.trim();
        if !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':') {
            current_host = Some(trimmed.trim_end_matches(':').to_string());
        } else if trimmed.starts_with("oauth_token:") {
            let token = trimmed.trim_start_matches("oauth_token:").trim();
            if !token.is_empty() {
                let host = current_host.clone().unwrap_or_else(|| "github.com".to_string());
                let mut fields = HashMap::new();
                fields.insert("api_key".to_string(), mask_value(token));
                results.push(ForagedCredential {
                    id: format!("ghcli:{host}"),
                    label: format!("GitHub CLI -- {host}"),
                    service_type: "github".to_string(),
                    source: ForageSource::GitHubCli,
                    fields,
                    already_imported: false,
                    confidence: ForageConfidence::High,
                });
            }
        }
    }

    results
}

/// Scan ~/.ssh/ for SSH key files (detection only, no secret import).
fn scan_ssh_keys() -> Vec<ForagedCredential> {
    let mut results = Vec::new();
    let Some(home) = home_dir() else { return results };
    let ssh_dir = home.join(".ssh");

    let entries = match std::fs::read_dir(&ssh_dir) {
        Ok(e) => e,
        Err(_) => return results,
    };

    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        // Only detect common key files (not the private keys themselves)
        if name.ends_with(".pub") {
            let key_name = name.trim_end_matches(".pub");
            let mut fields = HashMap::new();
            fields.insert("key_file".to_string(), format!("~/.ssh/{key_name}"));
            results.push(ForagedCredential {
                id: format!("ssh:key:{key_name}"),
                label: format!("SSH Key -- {key_name}"),
                service_type: "ssh".to_string(),
                source: ForageSource::SshKey,
                fields,
                already_imported: false,
                confidence: ForageConfidence::Low,
            });
        }
    }

    results
}

/// Mark credentials that already exist in the vault.
fn mark_existing(
    results: &mut [ForagedCredential],
    existing_service_types: &HashSet<String>,
) {
    for cred in results.iter_mut() {
        if existing_service_types.contains(&cred.service_type) {
            cred.already_imported = true;
        }
    }
}

/// Deduplicate results -- prefer higher confidence and env vars over dotenv.
fn deduplicate(results: Vec<ForagedCredential>) -> Vec<ForagedCredential> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut deduped: Vec<ForagedCredential> = Vec::new();

    for cred in results {
        let key = format!("{}:{}", cred.service_type, cred.id);
        if let Some(&idx) = seen.get(&key) {
            // Keep higher confidence one
            let existing_conf = match deduped[idx].confidence {
                ForageConfidence::High => 3,
                ForageConfidence::Medium => 2,
                ForageConfidence::Low => 1,
            };
            let new_conf = match cred.confidence {
                ForageConfidence::High => 3,
                ForageConfidence::Medium => 2,
                ForageConfidence::Low => 1,
            };
            if new_conf > existing_conf {
                deduped[idx] = cred;
            }
        } else {
            seen.insert(key, deduped.len());
            deduped.push(cred);
        }
    }

    deduped
}

// -- Tauri Commands -----------------------------------------------------

/// Scan the local filesystem for discoverable credentials.
#[tauri::command]
pub fn scan_credential_sources(
    state: State<'_, Arc<AppState>>,
) -> Result<ForagingScanResult, String> {
    require_privileged_sync(&state, "scan_credential_sources").map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();

    // Get existing credential service types to mark duplicates
    let existing_types: HashSet<String> =
        crate::db::repos::resources::credentials::get_distinct_service_types(&state.db)
            .unwrap_or_default();

    let mut scanned_sources = Vec::new();
    let mut all_results = Vec::new();

    // Scan each source
    scanned_sources.push("Environment variables".to_string());
    all_results.extend(scan_env_vars());

    scanned_sources.push("~/.aws/credentials".to_string());
    all_results.extend(scan_aws_credentials());

    scanned_sources.push("~/.kube/config".to_string());
    all_results.extend(scan_kube_config());

    scanned_sources.push(".env files".to_string());
    all_results.extend(scan_dotenv_files());

    scanned_sources.push("~/.npmrc".to_string());
    all_results.extend(scan_npmrc());

    scanned_sources.push("~/.docker/config.json".to_string());
    all_results.extend(scan_docker_config());

    scanned_sources.push("GitHub CLI config".to_string());
    all_results.extend(scan_github_cli());

    scanned_sources.push("~/.ssh/".to_string());
    all_results.extend(scan_ssh_keys());

    mark_existing(&mut all_results, &existing_types);
    let credentials = deduplicate(all_results);

    let duration = start.elapsed();

    Ok(ForagingScanResult {
        credentials,
        scanned_sources,
        scan_duration_ms: duration.as_millis() as u64,
    })
}

/// Import a foraged credential into the vault.
/// Reads the actual (unmasked) value from the original source at import time.
///
/// The credential row, encrypted fields, and audit log entry are written in a
/// single SQLite transaction so either all writes succeed or none do.
#[tauri::command]
pub fn import_foraged_credential(
    state: State<'_, Arc<AppState>>,
    foraged_id: String,
    credential_name: String,
    service_type: String,
) -> Result<serde_json::Value, String> {
    require_privileged_sync(&state, "import_foraged_credential").map_err(|e| e.to_string())?;
    // Re-read the actual values from the source.
    // The fields HashMap contains raw secret material -- never log or emit it.
    let fields = resolve_real_values(&foraged_id, &service_type)
        .map_err(|e| format!("Failed to read credential values: {e}"))?;

    if fields.is_empty() {
        return Err("No credential values found at source. The credential may have been removed.".to_string());
    }

    let input = crate::db::models::CreateCredentialInput {
        name: credential_name.clone(),
        service_type: service_type.clone(),
        encrypted_data: String::new(),
        iv: String::new(),
        metadata: None,
        session_encrypted_data: None,
        healthcheck_passed: None,
    };

    let mut conn = state.db.get()
        .map_err(|e| format!("Failed to get DB connection: {e}"))?;
    let tx = conn.transaction()
        .map_err(|e| format!("Failed to start transaction: {e}"))?;

    let cred_id = crate::db::repos::resources::credentials::insert_credential_and_fields_tx(
        &state.db, &tx, &input, &fields,
    ).map_err(|e| format!("Failed to create credential: {e}"))?;

    // Audit log in the same transaction
    let audit_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO credential_audit_log (id, credential_id, credential_name, operation, persona_id, persona_name, detail, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![audit_id, cred_id, credential_name, "create", Option::<&str>::None, Option::<&str>::None, "Imported via credential foraging", now],
    ).map_err(|e| format!("Failed to insert audit log: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Failed to commit transaction: {e}"))?;

    let cred = crate::db::repos::resources::credentials::get_by_id(&state.db, &cred_id)
        .map_err(|e| format!("Failed to read created credential: {e}"))?;

    Ok(serde_json::json!({
        "id": cred.id,
        "name": cred.name,
        "service_type": cred.service_type,
        "field_count": fields.len(),
    }))
}

/// Check that a string component contains no path traversal sequences or
/// directory separators that could escape expected filesystem boundaries.
fn is_safe_path_component(s: &str) -> bool {
    !s.contains("..")
        && !s.contains('/')
        && !s.contains('\\')
        && !s.contains('\0')
}

/// The only dotenv source labels the scanner produces.
const ALLOWED_DOTENV_SOURCES: &[&str] = &[".env (cwd)", "~/.env"];

// -- Trait-based resolution dispatch ------------------------------------

/// Read a file relative to the user's home directory.
fn read_home_file(relative: &[&str]) -> Result<String, String> {
    let home = home_dir().ok_or("Cannot determine home directory")?;
    let path = relative.iter().fold(home, |p, seg| p.join(seg));
    std::fs::read_to_string(&path)
        .map_err(|e| format!("Cannot read {}: {e}", path.display()))
}

/// Trait for resolving real (unmasked) credential values from a foraged source.
trait ForageSourceResolver {
    /// Resolve credential fields from the original source.
    /// `parts` contains the foraged ID segments after the source prefix.
    fn resolve(&self, parts: &[&str]) -> Result<HashMap<String, String>, String>;
}

struct EnvResolver;
struct AwsProfileResolver;
struct DotenvResolver;
struct GitHubCliResolver;
struct NpmrcResolver;

impl ForageSourceResolver for EnvResolver {
    fn resolve(&self, parts: &[&str]) -> Result<HashMap<String, String>, String> {
        let svc = parts.first().unwrap_or(&"");
        if !is_safe_path_component(svc) {
            return Err("Invalid service type in foraged ID".to_string());
        }
        let mut fields = HashMap::new();
        for &(env_key, service_type, field_key) in ENV_PATTERNS {
            if service_type == *svc {
                if let Ok(value) = std::env::var(env_key) {
                    if !value.is_empty() {
                        fields.insert(field_key.to_string(), value);
                    }
                }
            }
        }
        Ok(fields)
    }
}

impl ForageSourceResolver for AwsProfileResolver {
    fn resolve(&self, parts: &[&str]) -> Result<HashMap<String, String>, String> {
        let profile = parts.get(1).unwrap_or(&"default");
        if !is_safe_path_component(profile) {
            return Err("Invalid AWS profile name in foraged ID".to_string());
        }
        let content = read_home_file(&[".aws", "credentials"])?;

        let mut in_profile = false;
        let mut fields = HashMap::new();

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('[') && trimmed.ends_with(']') {
                let section = &trimmed[1..trimmed.len() - 1];
                in_profile = section == *profile;
                if !in_profile && !fields.is_empty() {
                    break;
                }
            } else if in_profile {
                if let Some(eq_pos) = trimmed.find('=') {
                    let key = trimmed[..eq_pos].trim();
                    let val = trimmed[eq_pos + 1..].trim();
                    if !val.is_empty() {
                        let field_key = match key {
                            "aws_access_key_id" => "access_key_id",
                            "aws_secret_access_key" => "secret_access_key",
                            "aws_session_token" => "session_token",
                            "region" => "region",
                            other => other,
                        };
                        fields.insert(field_key.to_string(), val.to_string());
                    }
                }
            }
        }

        Ok(fields)
    }
}

impl ForageSourceResolver for DotenvResolver {
    fn resolve(&self, parts: &[&str]) -> Result<HashMap<String, String>, String> {
        let source = parts.first().unwrap_or(&"");
        let key = parts.get(1).unwrap_or(&"");
        if !ALLOWED_DOTENV_SOURCES.contains(source) {
            return Err("Invalid dotenv source in foraged ID".to_string());
        }
        let key_known = ENV_PATTERNS.iter().any(|&(env_key, _, _)| env_key == *key);
        if !key_known {
            return Err("Unknown key in foraged ID".to_string());
        }

        let path = if source.starts_with('~') {
            let home = home_dir().ok_or("Cannot determine home directory")?;
            home.join(source.trim_start_matches("~/"))
        } else {
            PathBuf::from(".env")
        };

        let content = std::fs::read_to_string(&path)
            .map_err(|e| format!("Cannot read {source}: {e}"))?;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let Some(eq_pos) = trimmed.find('=') else { continue };
            let k = trimmed[..eq_pos].trim();
            let val = trimmed[eq_pos + 1..].trim().trim_matches('"').trim_matches('\'');
            if k == *key && !val.is_empty() {
                for &(env_key, _svc, field_key) in ENV_PATTERNS {
                    if env_key == *key {
                        let mut fields = HashMap::new();
                        fields.insert(field_key.to_string(), val.to_string());
                        return Ok(fields);
                    }
                }
            }
        }

        Err(format!("Key {key} not found in {source}"))
    }
}

impl ForageSourceResolver for GitHubCliResolver {
    fn resolve(&self, parts: &[&str]) -> Result<HashMap<String, String>, String> {
        let host = parts.first().unwrap_or(&"github.com");
        if !is_safe_path_component(host) {
            return Err("Invalid host in foraged ID".to_string());
        }

        let content = read_home_file(&[".config", "gh", "hosts.yml"])
            .or_else(|_| read_home_file(&["AppData", "Roaming", "GitHub CLI", "hosts.yml"]))?;

        let mut current_host: Option<String> = None;
        for line in content.lines() {
            let trimmed = line.trim();
            if !line.starts_with(' ') && !line.starts_with('\t') && trimmed.ends_with(':') {
                current_host = Some(trimmed.trim_end_matches(':').to_string());
            } else if trimmed.starts_with("oauth_token:") {
                let token = trimmed.trim_start_matches("oauth_token:").trim();
                if let Some(ref h) = current_host {
                    if h == *host && !token.is_empty() {
                        let mut fields = HashMap::new();
                        fields.insert("api_key".to_string(), token.to_string());
                        return Ok(fields);
                    }
                }
            }
        }

        Err(format!("No token found for host {host}"))
    }
}

impl ForageSourceResolver for NpmrcResolver {
    fn resolve(&self, _parts: &[&str]) -> Result<HashMap<String, String>, String> {
        let content = read_home_file(&[".npmrc"])?;

        for line in content.lines() {
            let trimmed = line.trim();
            if let Some(pos) = trimmed.find("_authToken=") {
                let token = &trimmed[pos + 11..];
                if !token.is_empty() {
                    let mut fields = HashMap::new();
                    fields.insert("token".to_string(), token.to_string());
                    return Ok(fields);
                }
            }
        }

        Err("No auth token found in ~/.npmrc".to_string())
    }
}

/// Re-read the actual (unmasked) credential values from the original source.
/// Return value contains raw secret material -- callers must never log or emit it.
#[tracing::instrument(skip_all)]
fn resolve_real_values(
    foraged_id: &str,
    _service_type: &str,
) -> Result<HashMap<String, String>, String> {
    let parts: Vec<&str> = foraged_id.splitn(3, ':').collect();
    if parts.is_empty() {
        return Err("Invalid foraged ID format".to_string());
    }

    let resolver: &dyn ForageSourceResolver = match parts[0] {
        "env" => &EnvResolver,
        "aws" => &AwsProfileResolver,
        "dotenv" => &DotenvResolver,
        "ghcli" => &GitHubCliResolver,
        "npmrc" => &NpmrcResolver,
        other => return Err(format!("Import not supported for source type: {other}")),
    };

    resolver.resolve(&parts[1..])
}
