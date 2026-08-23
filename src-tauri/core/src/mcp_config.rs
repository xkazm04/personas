//! The one typed model for the `mcpServers` config blocks personas writes.
//!
//! Personas emits `mcpServers` JSON from eight places — the per-execution
//! `--mcp-config` sidecar, Fleet's per-session Athena endpoint, the browser
//! bridge, the Artist and auto-credential browser turns, the Studio build
//! turns, and the two installers that register personas into a *user's own*
//! Claude Code / Cursor / Claude Desktop config. Every one of them hand-rolled
//! a `serde_json::json!` literal, and they had drifted into five different
//! conventions for the same field:
//!
//! - `"transport": "stdio"` — a key no MCP or Agent Plugins schema defines, so
//!   it was silently ignored by every reader (the installer that wrote it).
//! - no discriminator at all — two sites relied on readers inferring the
//!   transport from the presence of `command`.
//! - `"type": "stdio"` / `"type": "http"` — the three sites that were right.
//!
//! Agent Plugins 1.0.0 canonicalizes exactly this object (`type` required,
//! `stdio` | `streamable-http` | `sse`), which is what prompted the cleanup.
//! Constructing these entries through one type means the discriminator cannot
//! be forgotten again, and a future spec move is a one-file change.
//!
//! ## Why HTTP still serializes as `"http"`
//!
//! MCP and Agent Plugins both name the modern HTTP transport
//! `streamable-http`. The files this module produces are read by Claude Code,
//! Cursor, and Claude Desktop, and `"http"` is the value those clients accept
//! today — it is what the live Fleet/Athena and browser-bridge paths already
//! emit and are verified working with. Renaming the wire value is therefore a
//! behavior change against a third-party reader, not a refactor, and it needs a
//! live test rather than a compile. It is deliberately NOT bundled here; see
//! [`MCP_HTTP_TYPE`].

use std::collections::BTreeMap;

use serde::Serialize;

/// The `type` value emitted for HTTP MCP servers.
///
/// Spelled `"http"` because that is what Claude Code / Cursor / Claude Desktop
/// accept. The MCP spec and Agent Plugins 1.0.0 call this transport
/// `streamable-http`; switch this constant (and re-verify the Fleet + browser
/// bridge paths against a live CLI) if and when those readers take the
/// canonical name.
pub const MCP_HTTP_TYPE: &str = "http";

fn is_false(b: &bool) -> bool {
    !*b
}

/// One entry in an `mcpServers` object.
///
/// Field sets are deliberately minimal — exactly what personas' writers use.
/// Optional collections are omitted when empty so the emitted JSON stays as
/// close as possible to what each site produced before, and so a reader never
/// sees `"args": []` where it previously saw nothing.
#[derive(Debug, Clone, Serialize)]
#[serde(untagged)]
pub enum McpServer {
    Stdio {
        /// Discriminator. Always `"stdio"`; carried as a field rather than a
        /// serde tag so the JSON key order stays `type, command, args, …`.
        #[serde(rename = "type")]
        kind: StdioTag,
        command: String,
        #[serde(skip_serializing_if = "Vec::is_empty")]
        args: Vec<String>,
        #[serde(skip_serializing_if = "BTreeMap::is_empty")]
        env: BTreeMap<String, String>,
        /// Claude Code ≥ 2.1.121: load this server's tools without waiting for
        /// first use. Older CLIs ignore unknown server-config fields.
        #[serde(rename = "alwaysLoad", skip_serializing_if = "is_false")]
        always_load: bool,
    },
    Http {
        #[serde(rename = "type")]
        kind: HttpTag,
        url: String,
        #[serde(skip_serializing_if = "BTreeMap::is_empty")]
        headers: BTreeMap<String, String>,
    },
}

/// Serializes as the literal `"stdio"`.
#[derive(Debug, Clone, Copy)]
pub struct StdioTag;

impl Serialize for StdioTag {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str("stdio")
    }
}

/// Serializes as [`MCP_HTTP_TYPE`].
#[derive(Debug, Clone, Copy)]
pub struct HttpTag;

impl Serialize for HttpTag {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(MCP_HTTP_TYPE)
    }
}

impl McpServer {
    /// A stdio server: `command` plus optional `args`.
    pub fn stdio(
        command: impl Into<String>,
        args: impl IntoIterator<Item = impl Into<String>>,
    ) -> Self {
        McpServer::Stdio {
            kind: StdioTag,
            command: command.into(),
            args: args.into_iter().map(Into::into).collect(),
            env: BTreeMap::new(),
            always_load: false,
        }
    }

    /// An HTTP server: absolute `url`, optional `headers`.
    pub fn http(url: impl Into<String>) -> Self {
        McpServer::Http {
            kind: HttpTag,
            url: url.into(),
            headers: BTreeMap::new(),
        }
    }

    /// Set one environment variable on a stdio server. No-op on HTTP.
    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        if let McpServer::Stdio { env, .. } = &mut self {
            env.insert(key.into(), value.into());
        }
        self
    }

    /// Replace the whole env map on a stdio server. No-op on HTTP.
    pub fn with_env_map(mut self, vars: BTreeMap<String, String>) -> Self {
        if let McpServer::Stdio { env, .. } = &mut self {
            *env = vars;
        }
        self
    }

    /// Set one header on an HTTP server. No-op on stdio.
    pub fn with_header(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        if let McpServer::Http { headers, .. } = &mut self {
            headers.insert(key.into(), value.into());
        }
        self
    }

    /// Mark a stdio server as eagerly loaded. No-op on HTTP.
    pub fn always_loaded(mut self) -> Self {
        if let McpServer::Stdio { always_load, .. } = &mut self {
            *always_load = true;
        }
        self
    }

    /// This entry as a bare JSON value, for the two installers that merge a
    /// single server into a user's pre-existing config rather than writing a
    /// whole file.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::to_value(self).expect("McpServer serializes infallibly")
    }
}

/// Wrap named servers as a complete `{"mcpServers": {…}}` document.
pub fn mcp_config_json<K: Into<String>>(
    servers: impl IntoIterator<Item = (K, McpServer)>,
) -> serde_json::Value {
    let map: serde_json::Map<String, serde_json::Value> = servers
        .into_iter()
        .map(|(name, server)| (name.into(), server.to_json()))
        .collect();
    serde_json::json!({ "mcpServers": serde_json::Value::Object(map) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stdio_carries_the_type_discriminator_and_omits_empty_collections() {
        let v = McpServer::stdio("npx", ["-y", "@playwright/mcp@latest"]).to_json();
        assert_eq!(v["type"], "stdio");
        assert_eq!(v["command"], "npx");
        assert_eq!(v["args"][1], "@playwright/mcp@latest");
        // The pre-cleanup literals wrote no empty `env`/`alwaysLoad`; keep the
        // emitted JSON identical for the sites that were already correct.
        assert!(v.get("env").is_none());
        assert!(v.get("alwaysLoad").is_none());
        // The key that used to be written here by the installer is gone.
        assert!(v.get("transport").is_none());
    }

    #[test]
    fn stdio_emits_env_and_always_load_when_set() {
        let v = McpServer::stdio("personas-mcp", ["--db-path", "/tmp/p.db"])
            .with_env("PERSONAS_API_KEY", "secret")
            .always_loaded()
            .to_json();
        assert_eq!(v["env"]["PERSONAS_API_KEY"], "secret");
        assert_eq!(v["alwaysLoad"], true);
    }

    #[test]
    fn http_uses_the_reader_accepted_type_value() {
        let v = McpServer::http("http://127.0.0.1:9420/mcp/rpc")
            .with_header("X-Athena-Session", "tok")
            .to_json();
        // Guards the live Fleet/Athena + browser-bridge wire contract: these
        // files are read by Claude Code, which takes "http". Changing this is a
        // behavior change against a third-party reader, not a refactor.
        assert_eq!(v["type"], MCP_HTTP_TYPE);
        assert_eq!(v["type"], "http");
        assert_eq!(v["headers"]["X-Athena-Session"], "tok");
    }

    #[test]
    fn config_document_nests_under_mcp_servers() {
        let doc = mcp_config_json([(
            "personas",
            McpServer::stdio("personas-mcp", ["--db-path", "x"]),
        )]);
        assert_eq!(doc["mcpServers"]["personas"]["type"], "stdio");
        assert_eq!(doc.as_object().unwrap().len(), 1);
    }
}
