//! Env var sanitization + per-credential OAuth refresh locks.
//!
//! Two concerns share this module because both gate what crosses the Rust ↔
//! spawned-subprocess boundary:
//!   · `sanitize_env_name` / `BLOCKED_ENV_NAMES` — refuse to expose env var
//!     names that would let a credential/MCP field hijack the child process
//!     (PATH injection, language-runtime hooks, shell init scripts, …).
//!   · `credential_refresh_lock` — serialise OAuth `refresh_token` grants for
//!     the same credential ID so two concurrent executions don't race and
//!     burn each other's freshly-minted access token.
//!
//! Both are used from `credentials.rs` during per-execution setup and
//! (`sanitize_env_name` only) from `mcp_tools.rs` when building the MCP child
//! env map. Keep the denylist conservative — items leaving this file become
//! attack surface on every persona execution.

use std::sync::{Arc, LazyLock};
use tokio::sync::Mutex;

use crate::keyed_pool::{KeyedResourcePool, PoolHandle};

/// Env var names that must never be overridden by credential/MCP field
/// injection. Any attempt to set one of these via a credential field is
/// dropped with a warning.
const BLOCKED_ENV_NAMES: &[&str] = &[
    // OS-level / linker injection
    "PATH",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES",
    "DYLD_LIBRARY_PATH",
    // System identity & shell
    "HOME",
    "SHELL",
    "USER",
    "LOGNAME",
    "SYSTEMROOT",
    "COMSPEC",
    "WINDIR",
    "TEMP",
    "TMP",
    // Language runtime code-execution vectors
    "NODE_OPTIONS",         // --require= arbitrary module loading
    "NODE_PATH",            // hijack Node module resolution
    "PYTHONPATH",           // hijack Python imports
    "PYTHONSTARTUP",        // execute Python script at interpreter start
    "PERL5OPT",             // inject Perl command-line flags
    "PERL5LIB",             // hijack Perl module search path
    "RUBYOPT",              // inject Ruby flags (e.g. -r for require)
    "RUBYLIB",              // hijack Ruby load path
    "JAVA_TOOL_OPTIONS",    // JVM agent/flag injection
    "JAVA_OPTIONS",         // alternative JVM flag injection
    "_JAVA_OPTIONS",        // alternative JVM flag injection
    "CLASSPATH",            // hijack Java class loading
    "DOTNET_STARTUP_HOOKS", // .NET assembly injection at startup
    "BASH_ENV",             // execute script when bash starts non-interactively
    "ENV",                  // execute script when sh starts
    "ZDOTDIR",              // redirect zsh config to attacker-controlled dir
];

/// Env var name *prefixes* that re-arm the exact-name code-execution vectors via
/// runner-config families. Package managers / language runners read whole
/// tool-prefixed namespaces and map them back onto the blocked knobs — e.g. npm
/// reads `npm_config_*` case-insensitively and forwards
/// `npm_config_node_options` as `--node-options`, re-arming NODE_OPTIONS on an
/// allowlisted runner even though the exact name `NODE_OPTIONS` is denied. The
/// exact-name denylist can't enumerate these, so block the whole family by
/// prefix. Each entry maps to a runner that `validate_mcp_command` allowlists
/// (npx/uv/bun/deno + python/pip + cargo). Keep this list tight — every prefix
/// here is a code-exec runner namespace, not a benign app config namespace.
const BLOCKED_ENV_PREFIXES: &[&str] = &[
    "NPM_CONFIG_", // npm forwards npm_config_* (incl. node-options) to the runtime
    "UV_",         // uv / uvx config knobs (index/cache/python/runner overrides)
    "BUN_",        // bun runtime + install config knobs
    "DENO_",       // deno runtime knobs (DENO_DIR, etc.)
    "PIP_",        // pip config (index-url / extra args)
    "CARGO_",      // cargo config knobs (build/runner/rustflags overrides)
];

/// Sanitize an env var name: strip non-alphanumeric/underscore chars, uppercase,
/// and check against the exact-name denylist AND the blocked prefix families.
/// Returns `None` if the name is blocked or empty.
pub(crate) fn sanitize_env_name(name: &str) -> Option<String> {
    let sanitized: String = name
        .to_uppercase()
        .replace('-', "_")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();

    if sanitized.is_empty() {
        return None;
    }

    if BLOCKED_ENV_NAMES.contains(&sanitized.as_str()) {
        tracing::warn!(env_var = %sanitized, "Blocked dangerous env var name from credential injection");
        return None;
    }

    // Reject runner-config families by prefix (checked AFTER uppercasing so
    // `npm_config_node_options` -> `NPM_CONFIG_NODE_OPTIONS` -> blocked). These
    // map back onto the exact-name code-exec knobs the denylist already blocks.
    for &prefix in BLOCKED_ENV_PREFIXES {
        if sanitized.starts_with(prefix) {
            tracing::warn!(
                env_var = %sanitized,
                blocked_prefix = prefix,
                "Blocked env var name matching a code-exec runner-config prefix family"
            );
            return None;
        }
    }

    Some(sanitized)
}

/// Per-credential mutex pool to prevent concurrent OAuth token refreshes from
/// racing. Uses [`KeyedResourcePool`] with RAII handles and automatic pruning
/// (every 32 acquisitions, threshold 8 entries).
static CREDENTIAL_REFRESH_LOCKS: LazyLock<KeyedResourcePool<String, Arc<Mutex<()>>>> =
    LazyLock::new(|| KeyedResourcePool::new(32, 8));

/// Acquire a per-credential refresh lock. The returned [`PoolHandle`] holds a
/// clone of the `Arc<Mutex<()>>` and decrements the active-user count when
/// dropped, making the entry eligible for future pruning.
pub(super) fn credential_refresh_lock(credential_id: &str) -> PoolHandle<String, Arc<Mutex<()>>> {
    CREDENTIAL_REFRESH_LOCKS.acquire(credential_id.to_string(), || Arc::new(Mutex::new(())))
}

#[cfg(test)]
mod env_name_sanitization_tests {
    use super::sanitize_env_name;

    #[test]
    fn blocks_exact_name_denylist() {
        assert_eq!(sanitize_env_name("NODE_OPTIONS"), None);
        assert_eq!(sanitize_env_name("ld_preload"), None); // case-insensitive
        assert_eq!(sanitize_env_name("PYTHONPATH"), None);
    }

    #[test]
    fn blocks_runner_config_prefix_families() {
        // npm forwards npm_config_node_options -> --node-options, re-arming the
        // exact-name-blocked NODE_OPTIONS vector on an allowlisted runner.
        assert_eq!(sanitize_env_name("npm_config_node_options"), None);
        assert_eq!(sanitize_env_name("NPM_CONFIG_NODE_OPTIONS"), None);
        // uv / bun / deno / pip / cargo runner-config families.
        assert_eq!(sanitize_env_name("UV_INDEX_URL"), None);
        assert_eq!(sanitize_env_name("BUN_INSTALL"), None);
        assert_eq!(sanitize_env_name("deno_dir"), None);
        assert_eq!(sanitize_env_name("PIP_INDEX_URL"), None);
        assert_eq!(sanitize_env_name("CARGO_BUILD_RUSTFLAGS"), None);
    }

    #[test]
    fn allows_benign_env_vars() {
        // Benign credential/app vars that don't hit a blocked name or family.
        assert_eq!(
            sanitize_env_name("MY_API_BASE"),
            Some("MY_API_BASE".to_string())
        );
        assert_eq!(sanitize_env_name("api_key"), Some("API_KEY".to_string()));
        assert_eq!(
            sanitize_env_name("SLACK_BOT_TOKEN"),
            Some("SLACK_BOT_TOKEN".to_string())
        );
    }
}
