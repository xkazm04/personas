use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::models::CreateConnectorDefinitionInput;
use crate::db::repos::resources::connectors as connector_repo;
use crate::error::AppError;
use crate::ipc_auth::require_privileged_sync;
use crate::AppState;

// ============================================================================
// Types — exported to TypeScript via ts-rs
// ============================================================================

/// A single parameter extracted from an OpenAPI operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiParameter {
    pub name: String,
    pub location: String, // "query", "header", "path", "cookie"
    pub required: bool,
    pub param_type: String,
    pub description: Option<String>,
}

/// A single endpoint extracted from an OpenAPI spec.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiEndpoint {
    pub path: String,
    pub method: String,
    pub operation_id: Option<String>,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub tags: Vec<String>,
    pub parameters: Vec<OpenApiParameter>,
    pub request_body_type: Option<String>,
    pub response_type: Option<String>,
}

/// An authentication scheme extracted from the spec.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiAuthScheme {
    pub name: String,
    pub scheme_type: String, // "apiKey", "http", "oauth2", "openIdConnect"
    pub location: Option<String>, // "header", "query", "cookie" (for apiKey)
    pub param_name: Option<String>, // header/query param name
    pub scheme: Option<String>, // "bearer", "basic" (for http)
    pub description: Option<String>,
    pub flows: Option<serde_json::Value>, // OAuth2 flows if applicable
}

/// A data model (schema) extracted from the spec.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiModel {
    pub name: String,
    pub model_type: String, // "object", "array", "string", etc.
    pub description: Option<String>,
    pub properties: Vec<OpenApiModelProperty>,
}

/// A single property within a data model.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiModelProperty {
    pub name: String,
    pub property_type: String,
    pub required: bool,
    pub description: Option<String>,
}

/// Full result of parsing an OpenAPI spec.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct OpenApiParseResult {
    pub title: String,
    pub version: String,
    pub description: Option<String>,
    pub base_url: Option<String>,
    pub endpoints: Vec<OpenApiEndpoint>,
    pub auth_schemes: Vec<OpenApiAuthScheme>,
    pub models: Vec<OpenApiModel>,
    pub spec_format: String, // "openapi3" or "swagger2"
}

/// Tool definition generated from an endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedToolDefinition {
    pub tool_name: String,
    pub label: String,
    pub description: String,
    pub method: String,
    pub path: String,
    pub parameters: Vec<OpenApiParameter>,
}

/// Result of generating a connector from parsed spec.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedConnectorResult {
    pub connector_id: String,
    pub connector_name: String,
    pub connector_label: String,
    pub tools: Vec<GeneratedToolDefinition>,
    pub credential_fields: Vec<serde_json::Value>,
    pub healthcheck_endpoint: Option<String>,
}

/// Result of testing an endpoint in the playground.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PlaygroundTestResult {
    pub status_code: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub duration_ms: u64,
    pub success: bool,
}

// ============================================================================
// Parsing Logic
// ============================================================================

/// Parse an OpenAPI/Swagger spec from JSON content.
fn parse_openapi_spec(content: &str) -> Result<OpenApiParseResult, AppError> {
    let doc: serde_json::Value = serde_json::from_str(content)
        .or_else(|_| serde_yaml::from_str::<serde_json::Value>(content).map_err(|e| {
            AppError::Validation(format!("Failed to parse spec as JSON or YAML: {}", e))
        }))?;

    let spec_format = if doc.get("openapi").is_some() {
        "openapi3"
    } else if doc.get("swagger").is_some() {
        "swagger2"
    } else {
        return Err(AppError::Validation(
            "Not a valid OpenAPI 3.x or Swagger 2.x spec: missing 'openapi' or 'swagger' field".into(),
        ));
    };

    // Info
    let info = doc.get("info").unwrap_or(&serde_json::Value::Null);
    let title = info.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled API").to_string();
    let version = info.get("version").and_then(|v| v.as_str()).unwrap_or("0.0.0").to_string();
    let description = info.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());

    // Base URL
    let base_url = extract_base_url(&doc, spec_format);

    // Auth schemes
    let auth_schemes = extract_auth_schemes(&doc, spec_format);

    // Endpoints
    let endpoints = extract_endpoints(&doc, spec_format);

    // Models
    let models = extract_models(&doc, spec_format);

    Ok(OpenApiParseResult {
        title,
        version,
        description,
        base_url,
        endpoints,
        auth_schemes,
        models,
        spec_format: spec_format.to_string(),
    })
}

fn extract_base_url(doc: &serde_json::Value, spec_format: &str) -> Option<String> {
    if spec_format == "openapi3" {
        doc.get("servers")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|s| s.get("url"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    } else {
        // Swagger 2
        let host = doc.get("host").and_then(|v| v.as_str()).unwrap_or("localhost");
        let base_path = doc.get("basePath").and_then(|v| v.as_str()).unwrap_or("/");
        let scheme = doc.get("schemes")
            .and_then(|s| s.as_array())
            .and_then(|a| a.first())
            .and_then(|v| v.as_str())
            .unwrap_or("https");
        Some(format!("{}://{}{}", scheme, host, base_path))
    }
}

fn extract_auth_schemes(doc: &serde_json::Value, spec_format: &str) -> Vec<OpenApiAuthScheme> {
    let security_defs = if spec_format == "openapi3" {
        doc.pointer("/components/securitySchemes")
    } else {
        doc.get("securityDefinitions")
    };

    let Some(defs) = security_defs.and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    defs.iter()
        .map(|(name, def)| {
            let scheme_type = def.get("type").and_then(|v| v.as_str()).unwrap_or("unknown").to_string();
            let location = def.get("in").and_then(|v| v.as_str()).map(|s| s.to_string());
            let param_name = def.get("name").and_then(|v| v.as_str()).map(|s| s.to_string());
            let scheme = def.get("scheme").and_then(|v| v.as_str()).map(|s| s.to_string());
            let description = def.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
            let flows = def.get("flows").cloned();

            OpenApiAuthScheme {
                name: name.clone(),
                scheme_type,
                location,
                param_name,
                scheme,
                description,
                flows,
            }
        })
        .collect()
}

fn extract_endpoints(doc: &serde_json::Value, _spec_format: &str) -> Vec<OpenApiEndpoint> {
    let Some(paths) = doc.get("paths").and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    let mut endpoints = Vec::new();
    let methods = ["get", "post", "put", "patch", "delete", "head", "options"];

    for (path, path_item) in paths {
        let Some(path_obj) = path_item.as_object() else { continue };

        // Path-level parameters
        let path_params = path_obj.get("parameters")
            .and_then(|v| v.as_array())
            .map(|arr| extract_parameters(arr))
            .unwrap_or_default();

        for method in &methods {
            let Some(operation) = path_obj.get(*method) else { continue };

            let operation_id = operation.get("operationId").and_then(|v| v.as_str()).map(|s| s.to_string());
            let summary = operation.get("summary").and_then(|v| v.as_str()).map(|s| s.to_string());
            let description = operation.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());

            let tags = operation.get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();

            // Merge path-level and operation-level parameters
            let mut parameters = path_params.clone();
            if let Some(op_params) = operation.get("parameters").and_then(|v| v.as_array()) {
                parameters.extend(extract_parameters(op_params));
            }

            let request_body_type = operation.get("requestBody")
                .and_then(|rb| rb.pointer("/content/application/json/schema/$ref"))
                .or_else(|| operation.get("requestBody").and_then(|rb| rb.pointer("/content/application/json/schema/type")))
                .and_then(|v| v.as_str())
                .map(|s| ref_to_name(s));

            let response_type = operation.get("responses")
                .and_then(|r| r.get("200").or_else(|| r.get("201")))
                .and_then(|r| r.pointer("/content/application/json/schema/$ref"))
                .or_else(|| operation.get("responses")
                    .and_then(|r| r.get("200").or_else(|| r.get("201")))
                    .and_then(|r| r.pointer("/schema/$ref"))) // Swagger 2
                .and_then(|v| v.as_str())
                .map(|s| ref_to_name(s));

            endpoints.push(OpenApiEndpoint {
                path: path.clone(),
                method: method.to_uppercase(),
                operation_id,
                summary,
                description,
                tags,
                parameters,
                request_body_type,
                response_type,
            });
        }
    }

    endpoints
}

fn extract_parameters(params: &[serde_json::Value]) -> Vec<OpenApiParameter> {
    params.iter()
        .filter_map(|p| {
            let name = p.get("name")?.as_str()?.to_string();
            let location = p.get("in")?.as_str()?.to_string();
            let required = p.get("required").and_then(|v| v.as_bool()).unwrap_or(false);
            let param_type = p.get("schema")
                .and_then(|s| s.get("type"))
                .or_else(|| p.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("string")
                .to_string();
            let description = p.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());

            Some(OpenApiParameter { name, location, required, param_type, description })
        })
        .collect()
}

fn extract_models(doc: &serde_json::Value, spec_format: &str) -> Vec<OpenApiModel> {
    let schemas = if spec_format == "openapi3" {
        doc.pointer("/components/schemas")
    } else {
        doc.get("definitions")
    };

    let Some(defs) = schemas.and_then(|v| v.as_object()) else {
        return Vec::new();
    };

    defs.iter()
        .map(|(name, schema)| {
            let model_type = schema.get("type").and_then(|v| v.as_str()).unwrap_or("object").to_string();
            let description = schema.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());

            let required_fields: Vec<String> = schema.get("required")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                .unwrap_or_default();

            let properties = schema.get("properties")
                .and_then(|v| v.as_object())
                .map(|props| {
                    props.iter()
                        .map(|(pname, pval)| {
                            let property_type = pval.get("type")
                                .and_then(|v| v.as_str())
                                .or_else(|| pval.get("$ref").and_then(|v| v.as_str()))
                                .map(|s| ref_to_name(s))
                                .unwrap_or_else(|| "any".to_string());
                            let pdesc = pval.get("description").and_then(|v| v.as_str()).map(|s| s.to_string());
                            OpenApiModelProperty {
                                name: pname.clone(),
                                property_type,
                                required: required_fields.contains(pname),
                                description: pdesc,
                            }
                        })
                        .collect()
                })
                .unwrap_or_default();

            OpenApiModel { name: name.clone(), model_type, description, properties }
        })
        .collect()
}

/// Convert a $ref like "#/components/schemas/Pet" to just "Pet".
fn ref_to_name(s: &str) -> String {
    s.rsplit('/').next().unwrap_or(s).to_string()
}

// ============================================================================
// Connector & Tool Generation
// ============================================================================

fn generate_credential_fields(auth_schemes: &[OpenApiAuthScheme]) -> Vec<serde_json::Value> {
    if auth_schemes.is_empty() {
        return vec![serde_json::json!({
            "key": "api_key",
            "label": "API Key",
            "type": "password",
            "required": true,
            "placeholder": "Enter your API key"
        })];
    }

    let mut fields = Vec::new();
    for scheme in auth_schemes {
        match scheme.scheme_type.as_str() {
            "apiKey" => {
                fields.push(serde_json::json!({
                    "key": to_snake_case(&scheme.name),
                    "label": scheme.name.clone(),
                    "type": "password",
                    "required": true,
                    "placeholder": format!("Enter your {}", scheme.name),
                    "helpText": scheme.description.clone().unwrap_or_default()
                }));
            }
            "http" => {
                let label = match scheme.scheme.as_deref() {
                    Some("bearer") => "Bearer Token",
                    Some("basic") => "Username:Password",
                    _ => "API Token",
                };
                fields.push(serde_json::json!({
                    "key": "token",
                    "label": label,
                    "type": "password",
                    "required": true,
                    "placeholder": format!("Enter your {}", label.to_lowercase()),
                    "helpText": scheme.description.clone().unwrap_or_default()
                }));
            }
            "oauth2" => {
                fields.push(serde_json::json!({
                    "key": "client_id",
                    "label": "Client ID",
                    "type": "text",
                    "required": true,
                    "placeholder": "OAuth client ID"
                }));
                fields.push(serde_json::json!({
                    "key": "client_secret",
                    "label": "Client Secret",
                    "type": "password",
                    "required": true,
                    "placeholder": "OAuth client secret"
                }));
            }
            _ => {
                fields.push(serde_json::json!({
                    "key": to_snake_case(&scheme.name),
                    "label": scheme.name.clone(),
                    "type": "password",
                    "required": true,
                    "placeholder": format!("Enter {}", scheme.name)
                }));
            }
        }
    }

    // Always include base URL field
    fields.push(serde_json::json!({
        "key": "base_url",
        "label": "Base URL",
        "type": "url",
        "required": false,
        "placeholder": "Override the default base URL (optional)"
    }));

    fields
}

fn generate_tool_definitions(endpoints: &[OpenApiEndpoint]) -> Vec<GeneratedToolDefinition> {
    endpoints.iter()
        .map(|ep| {
            let tool_name = ep.operation_id.clone().unwrap_or_else(|| {
                let clean_path = ep.path.replace('/', "_").replace('{', "").replace('}', "");
                format!("{}_{}", ep.method.to_lowercase(), clean_path.trim_start_matches('_'))
            });

            let label = ep.summary.clone().unwrap_or_else(|| {
                format!("{} {}", ep.method, ep.path)
            });

            let description = ep.description.clone().unwrap_or_else(|| label.clone());

            GeneratedToolDefinition {
                tool_name: to_snake_case(&tool_name),
                label,
                description,
                method: ep.method.clone(),
                path: ep.path.clone(),
                parameters: ep.parameters.clone(),
            }
        })
        .collect()
}

fn find_healthcheck_endpoint(endpoints: &[OpenApiEndpoint]) -> Option<String> {
    // Prefer common health/status endpoints
    let health_patterns = ["/health", "/status", "/ping", "/api/health", "/api/status", "/api/v1/health"];
    for pattern in &health_patterns {
        if let Some(ep) = endpoints.iter().find(|e| e.path == *pattern && e.method == "GET") {
            return Some(ep.path.clone());
        }
    }
    // Fall back to first GET endpoint with no required params
    endpoints.iter()
        .find(|e| e.method == "GET" && e.parameters.iter().all(|p| !p.required || p.location == "path"))
        .map(|e| e.path.clone())
}

fn to_snake_case(s: &str) -> String {
    let mut result = String::new();
    for (i, ch) in s.chars().enumerate() {
        if ch.is_uppercase() && i > 0 {
            result.push('_');
        }
        if ch.is_alphanumeric() {
            result.push(ch.to_lowercase().next().unwrap_or(ch));
        } else if ch == '-' || ch == ' ' {
            result.push('_');
        }
    }
    result
}

// ============================================================================
// Tauri Commands
// ============================================================================

/// Parse an OpenAPI spec from a URL — fetches the spec and parses it.
#[tauri::command]
pub async fn openapi_parse_from_url(
    state: State<'_, Arc<AppState>>,
    url: String,
) -> Result<OpenApiParseResult, AppError> {
    require_privileged_sync(&state, "openapi_parse_from_url")?;

    let parsed_url = url::Url::parse(&url).map_err(|e| {
        AppError::Validation(format!("Invalid URL: {}", e))
    })?;

    // Only allow HTTPS URLs (or HTTP for localhost)
    match parsed_url.scheme() {
        "https" => {}
        "http" if parsed_url.host_str().map_or(false, |h| h == "localhost" || h == "127.0.0.1") => {}
        _ => return Err(AppError::Validation("Only HTTPS URLs are allowed (HTTP only for localhost)".into())),
    }

    let response = crate::SHARED_HTTP
        .get(url)
        .send()
        .await
        .map_err(|e| AppError::Validation(format!("Failed to fetch spec: {}", e)))?;

    if !response.status().is_success() {
        return Err(AppError::Validation(format!(
            "Failed to fetch spec: HTTP {}",
            response.status()
        )));
    }

    let body = response.text().await.map_err(|e| {
        AppError::Validation(format!("Failed to read response body: {}", e))
    })?;

    parse_openapi_spec(&body)
}

/// Parse an OpenAPI spec from raw content (JSON or YAML string).
#[tauri::command]
pub fn openapi_parse_from_content(
    state: State<'_, Arc<AppState>>,
    content: String,
) -> Result<OpenApiParseResult, AppError> {
    require_privileged_sync(&state, "openapi_parse_from_content")?;
    parse_openapi_spec(&content)
}

/// Generate a connector definition + tool definitions from a parsed spec.
/// Creates the connector in the database and returns the result.
#[tauri::command]
pub fn openapi_generate_connector(
    state: State<'_, Arc<AppState>>,
    parsed: OpenApiParseResult,
    selected_endpoints: Option<Vec<usize>>,
    custom_name: Option<String>,
    custom_color: Option<String>,
) -> Result<GeneratedConnectorResult, AppError> {
    require_privileged_sync(&state, "openapi_generate_connector")?;

    let connector_label = custom_name.unwrap_or_else(|| parsed.title.clone());
    let connector_name = to_snake_case(&connector_label);
    let color = custom_color.unwrap_or_else(|| "#3B82F6".to_string());

    // Filter endpoints if selection provided
    let endpoints: Vec<&OpenApiEndpoint> = if let Some(ref indices) = selected_endpoints {
        indices.iter().filter_map(|&i| parsed.endpoints.get(i)).collect()
    } else {
        parsed.endpoints.iter().collect()
    };

    let credential_fields = generate_credential_fields(&parsed.auth_schemes);
    let tools = generate_tool_definitions(&endpoints.iter().cloned().cloned().collect::<Vec<_>>());
    let healthcheck_ep = find_healthcheck_endpoint(&endpoints.iter().cloned().cloned().collect::<Vec<_>>());

    // Build services JSON for the connector
    let services_json: Vec<serde_json::Value> = tools.iter()
        .map(|t| serde_json::json!({
            "toolName": t.tool_name,
            "label": t.label,
        }))
        .collect();

    // Build healthcheck config
    let healthcheck_config = healthcheck_ep.as_ref().map(|ep| {
        serde_json::json!({
            "endpoint": ep,
            "method": "GET",
            "description": format!("Health check via {}", ep),
        }).to_string()
    });

    // Build metadata
    let metadata = serde_json::json!({
        "source": "openapi-autopilot",
        "spec_version": parsed.version,
        "spec_format": parsed.spec_format,
        "base_url": parsed.base_url,
        "auth_schemes": parsed.auth_schemes.iter().map(|a| &a.scheme_type).collect::<Vec<_>>(),
        "endpoint_count": endpoints.len(),
        "model_count": parsed.models.len(),
    });

    // Create the connector in the database
    let input = CreateConnectorDefinitionInput {
        name: connector_name.clone(),
        label: connector_label.clone(),
        icon_url: None,
        color: Some(color),
        category: Some("api-autopilot".into()),
        fields: serde_json::to_string(&credential_fields).unwrap_or_else(|_| "[]".into()),
        healthcheck_config,
        services: Some(serde_json::to_string(&services_json).unwrap_or_else(|_| "[]".into())),
        events: Some("[]".into()),
        metadata: Some(metadata.to_string()),
        is_builtin: Some(false),
    };

    let connector = connector_repo::create(&state.db, input)?;

    Ok(GeneratedConnectorResult {
        connector_id: connector.id,
        connector_name,
        connector_label,
        tools,
        credential_fields,
        healthcheck_endpoint: healthcheck_ep,
    })
}

/// Test an API endpoint in the playground.
#[tauri::command]
pub async fn openapi_playground_test(
    state: State<'_, Arc<AppState>>,
    base_url: String,
    path: String,
    method: String,
    headers: HashMap<String, String>,
    query_params: HashMap<String, String>,
    body: Option<String>,
) -> Result<PlaygroundTestResult, AppError> {
    require_privileged_sync(&state, "openapi_playground_test")?;

    // Validate URL
    let full_url = format!("{}{}", base_url.trim_end_matches('/'), path);
    let parsed = url::Url::parse(&full_url).map_err(|e| {
        AppError::Validation(format!("Invalid URL: {}", e))
    })?;

    // SSRF protection: only allow HTTPS or localhost HTTP
    match parsed.scheme() {
        "https" => {}
        "http" if parsed.host_str().map_or(false, |h| h == "localhost" || h == "127.0.0.1") => {}
        _ => return Err(AppError::Validation("Only HTTPS URLs are allowed (HTTP only for localhost)".into())),
    }

    let client = &crate::SSRF_SAFE_HTTP;
    let start = std::time::Instant::now();

    let mut request = match method.to_uppercase().as_str() {
        "GET" => client.get(&full_url),
        "POST" => client.post(&full_url),
        "PUT" => client.put(&full_url),
        "PATCH" => client.patch(&full_url),
        "DELETE" => client.delete(&full_url),
        "HEAD" => client.head(&full_url),
        other => return Err(AppError::Validation(format!("Unsupported HTTP method: {}", other))),
    };

    for (key, value) in &headers {
        request = request.header(key.as_str(), value.as_str());
    }

    if !query_params.is_empty() {
        request = request.query(&query_params.iter().collect::<Vec<_>>());
    }

    if let Some(ref body_str) = body {
        request = request
            .header("Content-Type", "application/json")
            .body(body_str.clone());
    }

    let response = request.send().await.map_err(|e| {
        AppError::Validation(format!("Request failed: {}", e))
    })?;

    let duration_ms = start.elapsed().as_millis() as u64;
    let status_code = response.status().as_u16();
    let success = response.status().is_success();

    let resp_headers: HashMap<String, String> = response.headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();

    let resp_body = response.text().await.unwrap_or_default();

    Ok(PlaygroundTestResult {
        status_code,
        headers: resp_headers,
        body: resp_body,
        duration_ms,
        success,
    })
}
