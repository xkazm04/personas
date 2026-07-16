//! Tests for the `personas-mcp` stdio auth gate.
//!
//! Exercises [`handle_jsonrpc`] end-to-end: the handshake methods stay open, and
//! `tools/call` is gated on a valid, correctly-scoped `pk_` token validated
//! against the shared `external_api_keys` registry, with rejections/successes
//! recorded in `api_key_audit`.

use serde_json::json;

use super::auth::MCP_REQUIRED_SCOPE;
use super::db::McpDbPool;
use super::handle_jsonrpc;
use crate::db::repos::resources::external_api_keys as api_key_repo;

/// A pool holding exactly the tables the auth path touches. Mirrors the direct-
/// table approach used by `external_api_keys`' own repo tests (the full migration
/// chain does not reliably leave `external_api_keys` present in the test binary).
fn test_pool() -> McpDbPool {
    let tmp = std::env::temp_dir().join(format!("mcp_auth_test_{}.db", uuid::Uuid::new_v4()));
    let pool = crate::db::open_pool_at(&tmp).expect("open pool");
    {
        let conn = pool.get().expect("conn");
        conn.execute_batch(
            "CREATE TABLE external_api_keys (
                id TEXT PRIMARY KEY, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE,
                key_prefix TEXT NOT NULL, scopes TEXT NOT NULL DEFAULT '[]',
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                last_used_at TEXT, revoked_at TEXT, expires_at TEXT,
                bound_origin TEXT, label TEXT
            );
            CREATE TABLE api_key_audit (
                id TEXT PRIMARY KEY, key_id TEXT NOT NULL,
                at TEXT NOT NULL DEFAULT (datetime('now')), method TEXT NOT NULL,
                path TEXT NOT NULL, status INTEGER NOT NULL, persona_id TEXT, origin TEXT
            );",
        )
        .expect("create tables");
    }
    McpDbPool::from_pool(pool)
}

fn tools_call(name: &str) -> String {
    json!({
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": { "name": name, "arguments": {} }
    })
    .to_string()
}

fn audit_count(pool: &McpDbPool) -> i64 {
    pool.get()
        .unwrap()
        .query_row("SELECT COUNT(*) FROM api_key_audit", [], |r| r.get(0))
        .unwrap()
}

#[test]
fn initialize_succeeds_without_token() {
    let pool = test_pool();
    let req = json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} }).to_string();
    let resp = handle_jsonrpc(&req, &pool, None).expect("response");
    assert!(resp.get("result").is_some(), "initialize must succeed without a token: {resp}");
    assert!(resp.get("error").is_none());
}

#[test]
fn tool_call_without_token_is_rejected() {
    let pool = test_pool();
    let resp = handle_jsonrpc(&tools_call("personas_health"), &pool, None).expect("response");
    let err = resp.get("error").expect("expected a JSON-RPC error");
    assert_eq!(err["code"], json!(-32001));
    let msg = err["message"].as_str().unwrap();
    assert!(msg.contains("Authentication required"), "msg: {msg}");
    assert!(msg.contains("install"), "error must name the fix (re-run install): {msg}");
    // Unregistered/absent token → nothing to audit per-key.
    assert_eq!(audit_count(&pool), 0);
}

#[test]
fn tool_call_with_unregistered_token_is_rejected() {
    let pool = test_pool();
    let resp = handle_jsonrpc(
        &tools_call("personas_health"),
        &pool,
        Some("pk_deadbeefdeadbeefdeadbeefdeadbeef"),
    )
    .expect("response");
    let err = resp.get("error").expect("expected a JSON-RPC error");
    assert_eq!(err["code"], json!(-32001));
    assert!(err["message"].as_str().unwrap().contains("Invalid or expired"));
}

#[test]
fn tool_call_with_underscoped_token_is_rejected_and_audited() {
    let pool = test_pool();
    // A valid key that lacks the required scope.
    let resp = api_key_repo::create(pool.pool(), "no-scope", vec![], None, None, None)
        .expect("create key");

    let out = handle_jsonrpc(
        &tools_call("personas_health"),
        &pool,
        Some(&resp.plaintext_token),
    )
    .expect("response");
    let err = out.get("error").expect("expected a JSON-RPC error");
    assert_eq!(err["code"], json!(-32001));
    assert!(err["message"].as_str().unwrap().contains(MCP_REQUIRED_SCOPE));

    // A 403 scope-denial is audited against the resolved key.
    assert_eq!(audit_count(&pool), 1);
    let (key_id, status): (String, i64) = pool
        .get()
        .unwrap()
        .query_row("SELECT key_id, status FROM api_key_audit", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(key_id, resp.record.id);
    assert_eq!(status, 403);
}

#[test]
fn tool_call_with_valid_scoped_token_passes_gate_and_audits_success() {
    let pool = test_pool();
    let resp = api_key_repo::create(
        pool.pool(),
        "mcp",
        vec![MCP_REQUIRED_SCOPE.to_string()],
        None,
        None,
        None,
    )
    .expect("create key");

    let out = handle_jsonrpc(
        &tools_call("personas_health"),
        &pool,
        Some(&resp.plaintext_token),
    )
    .expect("response");

    // The gate passed → a `result` (the tool ran), NOT the -32001 auth error.
    assert!(out.get("error").is_none(), "auth gate should not reject a scoped token: {out}");
    assert!(out.get("result").is_some(), "expected a tool result: {out}");

    // Success is audited as a 200 against the key.
    assert_eq!(audit_count(&pool), 1);
    let status: i64 = pool
        .get()
        .unwrap()
        .query_row("SELECT status FROM api_key_audit", [], |r| r.get(0))
        .unwrap();
    assert_eq!(status, 200);
}
