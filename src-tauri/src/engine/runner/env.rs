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
    "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    // System identity & shell
    "HOME", "SHELL", "USER", "LOGNAME",
    "SYSTEMROOT", "COMSPEC", "WINDIR",
    "TEMP", "TMP",
    // Language runtime code-execution vectors
    "NODE_OPTIONS",       // --require= arbitrary module loading
    "NODE_PATH",          // hijack Node module resolution
    "PYTHONPATH",         // hijack Python imports
    "PYTHONSTARTUP",      // execute Python script at interpreter start
    "PERL5OPT",           // inject Perl command-line flags
    "PERL5LIB",           // hijack Perl module search path
    "RUBYOPT",            // inject Ruby flags (e.g. -r for require)
    "RUBYLIB",            // hijack Ruby load path
    "JAVA_TOOL_OPTIONS",  // JVM agent/flag injection
    "JAVA_OPTIONS",       // alternative JVM flag injection
    "_JAVA_OPTIONS",      // alternative JVM flag injection
    "CLASSPATH",          // hijack Java class loading
    "DOTNET_STARTUP_HOOKS", // .NET assembly injection at startup
    "BASH_ENV",           // execute script when bash starts non-interactively
    "ENV",                // execute script when sh starts
    "ZDOTDIR",            // redirect zsh config to attacker-controlled dir
];

/// Sanitize an env var name: strip non-alphanumeric/underscore chars, uppercase,
/// and check against the denylist. Returns `None` if the name is blocked or empty.
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
