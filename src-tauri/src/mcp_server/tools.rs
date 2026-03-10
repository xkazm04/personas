//! MCP tool definitions and handlers for the Personas MCP server.

use serde_json::{json, Value};

use super::db::McpDbPool;

/// Return the list of available MCP tools with their schemas.
pub fn list_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "personas_list",
            "description": "List all personas (AI agents) in the system. Returns name, description, status, trust level, and configuration.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "enabled_only": { "type": "boolean", "description": "Only return enabled personas (default: false)" },
                    "group_id": { "type": "string", "description": "Filter by group/folder ID" }
                }
            }
        }),
        json!({
            "name": "personas_get",
            "description": "Get detailed information about a specific persona including its structured prompt, tools, triggers, and trust metadata.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "persona_id": { "type": "string", "description": "The persona UUID" }
                },
                "required": ["persona_id"]
            }
        }),
        json!({
            "name": "personas_execute",
            "description": "Trigger an execution of a persona with the given input data. Returns an execution ID for status polling.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "persona_id": { "type": "string", "description": "The persona UUID to execute" },
                    "input": { "type": "object", "description": "Input data to pass to the persona" }
                },
                "required": ["persona_id"]
            }
        }),
        json!({
            "name": "personas_status",
            "description": "Get the status of an execution (queued, running, completed, failed, cancelled).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "execution_id": { "type": "string", "description": "The execution UUID" }
                },
                "required": ["execution_id"]
            }
        }),
        json!({
            "name": "personas_result",
            "description": "Get the result of a completed execution including output, cost, duration, and tool usage.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "execution_id": { "type": "string", "description": "The execution UUID" }
                },
                "required": ["execution_id"]
            }
        }),
        json!({
            "name": "personas_knowledge_search",
            "description": "Search the knowledge base for learned patterns, annotations, and insights across all personas.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope_type": { "type": "string", "enum": ["persona", "tool", "connector", "global"], "description": "Scope to search" },
                    "scope_id": { "type": "string", "description": "Specific tool/connector name to search within" },
                    "limit": { "type": "number", "description": "Max results (default: 20)" }
                }
            }
        }),
        json!({
            "name": "personas_annotate",
            "description": "Add a knowledge annotation that will be shared across personas. Useful for recording API quirks, tool tips, or operational insights.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "description": "Scope format: 'tool:name', 'connector:type', 'global', or 'persona'" },
                    "note": { "type": "string", "description": "The annotation text" },
                    "persona_id": { "type": "string", "description": "Attribution persona ID (uses first available if omitted)" }
                },
                "required": ["scope", "note"]
            }
        }),
        json!({
            "name": "personas_health",
            "description": "Get system health status: active personas count, recent executions, knowledge entries, and scheduler state.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
        json!({
            "name": "personas_list_templates",
            "description": "Browse the template catalog with quality scores and adoption metrics.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "category": { "type": "string", "description": "Filter by template category" },
                    "limit": { "type": "number", "description": "Max results (default: 20)" }
                }
            }
        }),
    ]
}

/// Execute an MCP tool call and return the result.
pub fn call_tool(name: &str, args: &Value, pool: &McpDbPool) -> Value {
    let result = match name {
        "personas_list" => handle_personas_list(args, pool),
        "personas_get" => handle_personas_get(args, pool),
        "personas_execute" => handle_personas_execute(args, pool),
        "personas_status" => handle_personas_status(args, pool),
        "personas_result" => handle_personas_result(args, pool),
        "personas_knowledge_search" => handle_knowledge_search(args, pool),
        "personas_annotate" => handle_annotate(args, pool),
        "personas_health" => handle_health(args, pool),
        "personas_list_templates" => handle_list_templates(args, pool),
        _ => Err(format!("Unknown tool: {name}")),
    };

    match result {
        Ok(content) => json!({
            "content": [{ "type": "text", "text": content }],
            "isError": false
        }),
        Err(err) => json!({
            "content": [{ "type": "text", "text": err }],
            "isError": true
        }),
    }
}

fn handle_personas_list(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let enabled_only = args.get("enabled_only").and_then(|v| v.as_bool()).unwrap_or(false);
    let group_id = args.get("group_id").and_then(|v| v.as_str());

    let sql = if enabled_only {
        "SELECT id, name, description, enabled, trust_level, trust_origin, icon, color FROM personas WHERE enabled = 1 ORDER BY name"
    } else {
        "SELECT id, name, description, enabled, trust_level, trust_origin, icon, color FROM personas ORDER BY name"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;
    let rows = stmt.query_map([], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "name": row.get::<_, String>(1)?,
            "description": row.get::<_, Option<String>>(2)?,
            "enabled": row.get::<_, i32>(3)? != 0,
            "trust_level": row.get::<_, Option<String>>(4)?.unwrap_or_else(|| "verified".to_string()),
            "trust_origin": row.get::<_, Option<String>>(5)?.unwrap_or_else(|| "builtin".to_string()),
            "icon": row.get::<_, Option<String>>(6)?,
            "color": row.get::<_, Option<String>>(7)?,
        }))
    }).map_err(|e| format!("Query error: {e}"))?;

    let mut personas: Vec<Value> = rows.filter_map(|r| r.ok()).collect();

    if let Some(gid) = group_id {
        personas.retain(|p| p.get("group_id").and_then(|g| g.as_str()) == Some(gid));
    }

    serde_json::to_string_pretty(&personas).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_get(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let persona_id = args.get("persona_id").and_then(|v| v.as_str())
        .ok_or("persona_id is required")?;
    let conn = pool.get()?;

    let persona = conn.query_row(
        "SELECT id, name, description, system_prompt, structured_prompt, enabled, trust_level, trust_origin,
                max_concurrent, timeout_ms, max_budget_usd, max_turns, icon, color
         FROM personas WHERE id = ?1",
        rusqlite::params![persona_id],
        |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "description": row.get::<_, Option<String>>(2)?,
                "system_prompt": row.get::<_, String>(3)?,
                "has_structured_prompt": row.get::<_, Option<String>>(4)?.is_some(),
                "enabled": row.get::<_, i32>(5)? != 0,
                "trust_level": row.get::<_, Option<String>>(6)?.unwrap_or_else(|| "verified".to_string()),
                "trust_origin": row.get::<_, Option<String>>(7)?.unwrap_or_else(|| "builtin".to_string()),
                "max_concurrent": row.get::<_, i32>(8)?,
                "timeout_ms": row.get::<_, i32>(9)?,
                "max_budget_usd": row.get::<_, Option<f64>>(10)?,
                "max_turns": row.get::<_, Option<i32>>(11)?,
                "icon": row.get::<_, Option<String>>(12)?,
                "color": row.get::<_, Option<String>>(13)?,
            }))
        },
    ).map_err(|e| format!("Persona not found: {e}"))?;

    // Get assigned tools
    let mut tool_stmt = conn.prepare(
        "SELECT name, description, category FROM persona_tool_definitions WHERE persona_id = ?1",
    ).map_err(|e| format!("Query error: {e}"))?;
    let tools: Vec<Value> = tool_stmt.query_map(rusqlite::params![persona_id], |row| {
        Ok(json!({
            "name": row.get::<_, String>(0)?,
            "description": row.get::<_, String>(1)?,
            "category": row.get::<_, String>(2)?,
        }))
    }).map_err(|e| format!("Query error: {e}"))?.filter_map(|r| r.ok()).collect();

    let mut result = persona;
    result["tools"] = json!(tools);

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_execute(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let persona_id = args.get("persona_id").and_then(|v| v.as_str())
        .ok_or("persona_id is required")?;
    let input = args.get("input").cloned().unwrap_or(json!({}));
    let conn = pool.get()?;

    // Verify persona exists and is enabled
    let enabled: bool = conn.query_row(
        "SELECT enabled FROM personas WHERE id = ?1",
        rusqlite::params![persona_id],
        |row| Ok(row.get::<_, i32>(0)? != 0),
    ).map_err(|e| format!("Persona not found: {e}"))?;

    if !enabled {
        return Err("Persona is disabled".to_string());
    }

    // Create a queued execution record
    let exec_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let input_json = serde_json::to_string(&input).unwrap_or_else(|_| "{}".to_string());

    conn.execute(
        "INSERT INTO persona_executions (id, persona_id, input_data, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'queued', ?4, ?4)",
        rusqlite::params![exec_id, persona_id, input_json, now],
    ).map_err(|e| format!("Failed to queue execution: {e}"))?;

    // Publish an event so the main app's background loop picks it up
    let event_id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO persona_events (id, project_id, event_type, source_type, source_id, target_persona_id, payload, status, created_at)
         VALUES (?1, 'default', 'mcp_execute', 'mcp', 'personas-mcp', ?2, ?3, 'pending', ?4)",
        rusqlite::params![event_id, persona_id, json!({"execution_id": exec_id}).to_string(), now],
    ).map_err(|e| format!("Failed to publish event: {e}"))?;

    Ok(json!({
        "execution_id": exec_id,
        "status": "queued",
        "message": "Execution queued. Use personas_status to poll for completion."
    }).to_string())
}

fn handle_personas_status(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let execution_id = args.get("execution_id").and_then(|v| v.as_str())
        .ok_or("execution_id is required")?;
    let conn = pool.get()?;

    let result = conn.query_row(
        "SELECT id, persona_id, status, duration_ms, cost_usd, created_at, updated_at
         FROM persona_executions WHERE id = ?1",
        rusqlite::params![execution_id],
        |row| {
            Ok(json!({
                "execution_id": row.get::<_, String>(0)?,
                "persona_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "duration_ms": row.get::<_, Option<i64>>(3)?,
                "cost_usd": row.get::<_, Option<f64>>(4)?,
                "created_at": row.get::<_, String>(5)?,
                "updated_at": row.get::<_, String>(6)?,
            }))
        },
    ).map_err(|e| format!("Execution not found: {e}"))?;

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_personas_result(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let execution_id = args.get("execution_id").and_then(|v| v.as_str())
        .ok_or("execution_id is required")?;
    let conn = pool.get()?;

    let result = conn.query_row(
        "SELECT id, persona_id, status, output_data, duration_ms, cost_usd,
                input_tokens, output_tokens, model_used, tool_steps
         FROM persona_executions WHERE id = ?1",
        rusqlite::params![execution_id],
        |row| {
            Ok(json!({
                "execution_id": row.get::<_, String>(0)?,
                "persona_id": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
                "output": row.get::<_, Option<String>>(3)?,
                "duration_ms": row.get::<_, Option<i64>>(4)?,
                "cost_usd": row.get::<_, Option<f64>>(5)?,
                "input_tokens": row.get::<_, Option<i64>>(6)?,
                "output_tokens": row.get::<_, Option<i64>>(7)?,
                "model_used": row.get::<_, Option<String>>(8)?,
                "tool_steps": row.get::<_, Option<String>>(9)?,
            }))
        },
    ).map_err(|e| format!("Execution not found: {e}"))?;

    serde_json::to_string_pretty(&result).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_knowledge_search(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let scope_type = args.get("scope_type").and_then(|v| v.as_str());
    let scope_id = args.get("scope_id").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);

    let (sql, params): (&str, Vec<Box<dyn rusqlite::types::ToSql>>) = match (scope_type, scope_id) {
        (Some(st), Some(sid)) => (
            "SELECT * FROM execution_knowledge WHERE scope_type = ?1 AND scope_id = ?2 ORDER BY confidence DESC LIMIT ?3",
            vec![Box::new(st.to_string()), Box::new(sid.to_string()), Box::new(limit)],
        ),
        (Some(st), None) => (
            "SELECT * FROM execution_knowledge WHERE scope_type = ?1 ORDER BY confidence DESC LIMIT ?2",
            vec![Box::new(st.to_string()), Box::new(limit)],
        ),
        _ => (
            "SELECT * FROM execution_knowledge ORDER BY confidence DESC LIMIT ?1",
            vec![Box::new(limit)],
        ),
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;
    let param_refs: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();
    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "persona_id": row.get::<_, String>(1)?,
            "knowledge_type": row.get::<_, String>(3)?,
            "pattern_key": row.get::<_, String>(4)?,
            "confidence": row.get::<_, f64>(10)?,
            "scope_type": row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "persona".to_string()),
            "scope_id": row.get::<_, Option<String>>(15)?,
            "annotation_text": row.get::<_, Option<String>>(16)?,
            "is_verified": row.get::<_, Option<bool>>(18)?.unwrap_or(false),
        }))
    }).map_err(|e| format!("Query error: {e}"))?;

    let entries: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&entries).map_err(|e| format!("Serialize error: {e}"))
}

fn handle_annotate(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let scope = args.get("scope").and_then(|v| v.as_str())
        .ok_or("scope is required")?;
    let note = args.get("note").and_then(|v| v.as_str())
        .ok_or("note is required")?;

    let conn = pool.get()?;

    // Resolve persona_id — use provided or pick first available
    let persona_id = if let Some(pid) = args.get("persona_id").and_then(|v| v.as_str()) {
        pid.to_string()
    } else {
        conn.query_row("SELECT id FROM personas LIMIT 1", [], |row| row.get::<_, String>(0))
            .map_err(|_| "No personas available for attribution")?
    };

    // Parse scope
    let (scope_type, scope_id) = if let Some(rest) = scope.strip_prefix("tool:") {
        ("tool", Some(rest))
    } else if let Some(rest) = scope.strip_prefix("connector:") {
        ("connector", Some(rest))
    } else if scope == "global" {
        ("global", None)
    } else {
        ("persona", None)
    };

    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().to_rfc3339();
    let knowledge_type = "agent_annotation";
    let pattern_key = format!("{}:{}:mcp", scope_type, scope_id.unwrap_or("_global"));

    conn.execute(
        "INSERT INTO execution_knowledge
            (id, persona_id, knowledge_type, pattern_key, pattern_data,
             success_count, failure_count, avg_cost_usd, avg_duration_ms,
             confidence, created_at, updated_at,
             scope_type, scope_id, annotation_text, annotation_source, is_verified)
         VALUES (?1, ?2, ?3, ?4, '{}', 1, 0, 0.0, 0.0, 0.5, ?5, ?5,
                 ?6, ?7, ?8, 'mcp', 0)
         ON CONFLICT(persona_id, knowledge_type, pattern_key) DO UPDATE SET
            annotation_text = ?8, updated_at = ?5, success_count = success_count + 1",
        rusqlite::params![id, persona_id, knowledge_type, pattern_key, now, scope_type, scope_id, note],
    ).map_err(|e| format!("Failed to store annotation: {e}"))?;

    Ok(json!({
        "status": "stored",
        "scope": scope,
        "note": note
    }).to_string())
}

fn handle_health(_args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;

    let persona_count: i64 = conn.query_row("SELECT COUNT(*) FROM personas", [], |row| row.get(0))
        .unwrap_or(0);
    let enabled_count: i64 = conn.query_row("SELECT COUNT(*) FROM personas WHERE enabled = 1", [], |row| row.get(0))
        .unwrap_or(0);
    let recent_executions: i64 = conn.query_row(
        "SELECT COUNT(*) FROM persona_executions WHERE created_at >= datetime('now', '-24 hours')",
        [], |row| row.get(0),
    ).unwrap_or(0);
    let knowledge_entries: i64 = conn.query_row("SELECT COUNT(*) FROM execution_knowledge", [], |row| row.get(0))
        .unwrap_or(0);

    Ok(json!({
        "status": "healthy",
        "personas": { "total": persona_count, "enabled": enabled_count },
        "executions_24h": recent_executions,
        "knowledge_entries": knowledge_entries,
    }).to_string())
}

fn handle_list_templates(args: &Value, pool: &McpDbPool) -> Result<String, String> {
    let conn = pool.get()?;
    let category = args.get("category").and_then(|v| v.as_str());
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20);

    let sql = if category.is_some() {
        "SELECT id, test_case_name, instruction, status, structural_score, semantic_score, adoption_count, category
         FROM persona_design_reviews WHERE status = 'passed' AND category = ?1
         ORDER BY adoption_count DESC LIMIT ?2"
    } else {
        "SELECT id, test_case_name, instruction, status, structural_score, semantic_score, adoption_count, category
         FROM persona_design_reviews WHERE status = 'passed'
         ORDER BY adoption_count DESC LIMIT ?1"
    };

    let mut stmt = conn.prepare(sql).map_err(|e| format!("Query error: {e}"))?;

    let rows = if let Some(cat) = category {
        stmt.query_map(rusqlite::params![cat, limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "instruction": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "structural_score": row.get::<_, Option<i32>>(4)?,
                "semantic_score": row.get::<_, Option<i32>>(5)?,
                "adoption_count": row.get::<_, i32>(6)?,
                "category": row.get::<_, Option<String>>(7)?,
            }))
        }).map_err(|e| format!("Query error: {e}"))?
    } else {
        stmt.query_map(rusqlite::params![limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "instruction": row.get::<_, String>(2)?,
                "status": row.get::<_, String>(3)?,
                "structural_score": row.get::<_, Option<i32>>(4)?,
                "semantic_score": row.get::<_, Option<i32>>(5)?,
                "adoption_count": row.get::<_, i32>(6)?,
                "category": row.get::<_, Option<String>>(7)?,
            }))
        }).map_err(|e| format!("Query error: {e}"))?
    };

    let templates: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    serde_json::to_string_pretty(&templates).map_err(|e| format!("Serialize error: {e}"))
}
