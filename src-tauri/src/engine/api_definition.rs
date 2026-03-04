//! OpenAPI/Swagger specification parser.
//!
//! Parses OpenAPI 3.x and Swagger 2.x specs into a simplified endpoint list
//! suitable for the API Explorer playground.

use crate::error::AppError;

/// A single API endpoint extracted from an OpenAPI spec.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiEndpoint {
    pub method: String,
    pub path: String,
    pub summary: Option<String>,
    pub description: Option<String>,
    pub parameters: Vec<ApiParameter>,
    pub request_body: Option<ApiRequestBody>,
    pub tags: Vec<String>,
}

/// A parameter for an API endpoint.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiParameter {
    pub name: String,
    /// "path", "query", "header", or "cookie"
    pub location: String,
    pub required: bool,
    pub schema_type: Option<String>,
    pub description: Option<String>,
}

/// The request body schema for an endpoint.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ApiRequestBody {
    pub content_type: String,
    pub schema_json: Option<String>,
    pub required: bool,
}

const VALID_METHODS: &[&str] = &[
    "get", "post", "put", "patch", "delete", "head", "options",
];

/// Parse an OpenAPI/Swagger specification into a list of endpoints.
///
/// Accepts JSON or YAML format. Supports OpenAPI 3.x and Swagger 2.x.
pub fn parse_openapi_spec(raw: &str) -> Result<Vec<ApiEndpoint>, AppError> {
    let spec: serde_json::Value = serde_json::from_str(raw)
        .or_else(|_| serde_yaml::from_str(raw))
        .map_err(|e| {
            AppError::Validation(format!(
                "Invalid API definition (not valid JSON or YAML): {e}"
            ))
        })?;

    let paths = spec
        .get("paths")
        .and_then(|p| p.as_object())
        .ok_or_else(|| {
            AppError::Validation("API definition has no 'paths' object".into())
        })?;

    let mut endpoints = Vec::new();

    for (path, methods) in paths {
        let methods_obj = match methods.as_object() {
            Some(obj) => obj,
            None => continue,
        };

        for (method, operation) in methods_obj {
            if !VALID_METHODS.contains(&method.to_lowercase().as_str()) {
                continue;
            }

            let summary = operation
                .get("summary")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let description = operation
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            let tags: Vec<String> = operation
                .get("tags")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|t| t.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();

            // Parse parameters
            let parameters = parse_parameters(operation);

            // Parse request body (OpenAPI 3.x style)
            let request_body = parse_request_body(operation);

            endpoints.push(ApiEndpoint {
                method: method.to_uppercase(),
                path: path.clone(),
                summary,
                description,
                parameters,
                request_body,
                tags,
            });
        }
    }

    // Sort by path, then method for stable ordering
    endpoints.sort_by(|a, b| a.path.cmp(&b.path).then(a.method.cmp(&b.method)));

    Ok(endpoints)
}

fn parse_parameters(operation: &serde_json::Value) -> Vec<ApiParameter> {
    let params = match operation.get("parameters").and_then(|v| v.as_array()) {
        Some(arr) => arr,
        None => return Vec::new(),
    };

    params
        .iter()
        .filter_map(|p| {
            let name = p.get("name")?.as_str()?.to_string();
            let location = p
                .get("in")
                .and_then(|v| v.as_str())
                .unwrap_or("query")
                .to_string();
            let required = p
                .get("required")
                .and_then(|v| v.as_bool())
                .unwrap_or(location == "path");
            let schema_type = p
                .get("schema")
                .and_then(|s| s.get("type"))
                .and_then(|v| v.as_str())
                .or_else(|| p.get("type").and_then(|v| v.as_str()))
                .map(|s| s.to_string());
            let description = p
                .get("description")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            Some(ApiParameter {
                name,
                location,
                required,
                schema_type,
                description,
            })
        })
        .collect()
}

fn parse_request_body(operation: &serde_json::Value) -> Option<ApiRequestBody> {
    // OpenAPI 3.x: requestBody.content.application/json.schema
    if let Some(rb) = operation.get("requestBody") {
        let required = rb.get("required").and_then(|v| v.as_bool()).unwrap_or(false);
        let content = rb.get("content").and_then(|c| c.as_object())?;

        // Prefer application/json
        let (content_type, media) = content
            .iter()
            .find(|(k, _)| k.contains("json"))
            .or_else(|| content.iter().next())?;

        let schema_json = media
            .get("schema")
            .map(|s| serde_json::to_string_pretty(s).unwrap_or_default());

        return Some(ApiRequestBody {
            content_type: content_type.clone(),
            schema_json,
            required,
        });
    }

    // Swagger 2.x: body parameter with "in": "body"
    if let Some(params) = operation.get("parameters").and_then(|v| v.as_array()) {
        for p in params {
            if p.get("in").and_then(|v| v.as_str()) == Some("body") {
                let schema_json = p
                    .get("schema")
                    .map(|s| serde_json::to_string_pretty(s).unwrap_or_default());
                return Some(ApiRequestBody {
                    content_type: "application/json".to_string(),
                    schema_json,
                    required: p
                        .get("required")
                        .and_then(|v| v.as_bool())
                        .unwrap_or(false),
                });
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_simple_openapi3() {
        let spec = json!({
            "openapi": "3.0.0",
            "paths": {
                "/users": {
                    "get": {
                        "summary": "List users",
                        "tags": ["users"],
                        "parameters": [
                            {
                                "name": "limit",
                                "in": "query",
                                "schema": { "type": "integer" }
                            }
                        ]
                    },
                    "post": {
                        "summary": "Create user",
                        "tags": ["users"],
                        "requestBody": {
                            "required": true,
                            "content": {
                                "application/json": {
                                    "schema": { "type": "object" }
                                }
                            }
                        }
                    }
                },
                "/users/{id}": {
                    "get": {
                        "summary": "Get user",
                        "parameters": [
                            { "name": "id", "in": "path", "required": true, "schema": { "type": "string" } }
                        ]
                    }
                }
            }
        });

        let result = parse_openapi_spec(&spec.to_string()).unwrap();
        assert_eq!(result.len(), 3);

        let get_users = result.iter().find(|e| e.path == "/users" && e.method == "GET").unwrap();
        assert_eq!(get_users.summary.as_deref(), Some("List users"));
        assert_eq!(get_users.parameters.len(), 1);
        assert_eq!(get_users.parameters[0].name, "limit");

        let post_users = result.iter().find(|e| e.path == "/users" && e.method == "POST").unwrap();
        assert!(post_users.request_body.is_some());
        assert!(post_users.request_body.as_ref().unwrap().required);

        let get_user = result.iter().find(|e| e.path == "/users/{id}").unwrap();
        assert_eq!(get_user.parameters[0].name, "id");
        assert!(get_user.parameters[0].required);
    }

    #[test]
    fn test_parse_no_paths() {
        let spec = json!({ "openapi": "3.0.0" });
        let result = parse_openapi_spec(&spec.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_empty_paths() {
        let spec = json!({ "openapi": "3.0.0", "paths": {} });
        let result = parse_openapi_spec(&spec.to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_invalid_json() {
        let result = parse_openapi_spec("not valid");
        assert!(result.is_err());
    }
}
