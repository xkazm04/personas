use sha2::{Digest, Sha256};

use crate::db::models::{ConnectorDefinition, Persona, PersonaMemory};

/// Convert a PersonaMemory to an Obsidian-compatible markdown file with YAML frontmatter.
pub fn memory_to_markdown(memory: &PersonaMemory, persona_name: &str) -> String {
    let tags_yaml = match &memory.tags {
        Some(tags) if !tags.0.is_empty() => {
            let items: Vec<String> = tags.0.iter().map(|t| format!("  - \"{}\"", t)).collect();
            format!("tags:\n{}", items.join("\n"))
        }
        _ => "tags: []".into(),
    };

    format!(
        r#"---
id: "{id}"
persona: "{persona}"
category: "{category}"
importance: {importance}
tier: "{tier}"
{tags}
type: "persona-memory"
created: "{created}"
updated: "{updated}"
---

# {title}

{content}
"#,
        id = memory.id,
        persona = persona_name,
        category = memory.category,
        importance = memory.importance,
        tier = memory.tier,
        tags = tags_yaml,
        created = memory.created_at,
        updated = memory.updated_at,
        title = memory.title,
        content = memory.content,
    )
}

/// Convert a Persona to an Obsidian-compatible markdown profile document.
pub fn persona_to_markdown(persona: &Persona) -> String {
    let desc = persona
        .description
        .as_deref()
        .unwrap_or("No description");
    let model = persona
        .model_profile
        .as_deref()
        .unwrap_or("default");

    format!(
        r#"---
id: "{id}"
type: "persona-profile"
enabled: {enabled}
model_profile: "{model}"
trust_level: "{trust_level}"
trust_score: {trust_score}
max_concurrent: {max_concurrent}
timeout_ms: {timeout_ms}
created: "{created}"
updated: "{updated}"
---

# {name}

{desc}

## System Prompt

```
{system_prompt}
```

## Configuration

| Setting | Value |
|---------|-------|
| Enabled | {enabled} |
| Model | {model} |
| Max Concurrent | {max_concurrent} |
| Timeout | {timeout_ms}ms |
| Trust Level | {trust_level} |
| Trust Score | {trust_score} |
"#,
        id = persona.id,
        name = persona.name,
        desc = desc,
        enabled = persona.enabled,
        model = model,
        trust_level = persona.trust_level,
        trust_score = persona.trust_score,
        max_concurrent = persona.max_concurrent,
        timeout_ms = persona.timeout_ms,
        system_prompt = persona.system_prompt,
        created = persona.created_at,
        updated = persona.updated_at,
    )
}

/// Convert a ConnectorDefinition to an Obsidian-compatible markdown document.
pub fn connector_to_markdown(connector: &ConnectorDefinition) -> String {
    format!(
        r#"---
id: "{id}"
type: "connector"
category: "{category}"
is_builtin: {is_builtin}
created: "{created}"
updated: "{updated}"
---

# {label}

**Name**: `{name}`
**Category**: {category}
**Built-in**: {is_builtin}

## Services

{services}

## Events

{events}
"#,
        id = connector.id,
        name = connector.name,
        label = connector.label,
        category = connector.category,
        is_builtin = connector.is_builtin,
        services = connector.services,
        events = connector.events,
        created = connector.created_at,
        updated = connector.updated_at,
    )
}

/// Compute SHA-256 hash of content, returned as `sha256:<hex>`.
pub fn compute_content_hash(content: &str) -> String {
    let digest = Sha256::digest(content.as_bytes());
    format!("sha256:{}", hex::encode(digest))
}

/// Sanitize a title for use as a filesystem-safe filename (no extension).
pub fn sanitize_filename(title: &str) -> String {
    let sanitized: String = title
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();
    let trimmed = sanitized.trim().trim_matches('-');
    let truncated = if trimmed.len() > 100 {
        &trimmed[..100]
    } else {
        trimmed
    };
    if truncated.is_empty() {
        "untitled".into()
    } else {
        truncated.to_string()
    }
}

/// Parse YAML frontmatter from a markdown file. Returns (frontmatter_yaml, body).
pub fn parse_frontmatter(content: &str) -> Option<(String, String)> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    let after_first = &trimmed[3..];
    let end_idx = after_first.find("\n---")?;
    let yaml = after_first[..end_idx].trim().to_string();
    let body = after_first[end_idx + 4..].trim().to_string();
    Some((yaml, body))
}

/// Extract a string value from parsed YAML frontmatter by key.
pub fn extract_yaml_field(yaml: &str, key: &str) -> Option<String> {
    for line in yaml.lines() {
        let line = line.trim();
        if line.starts_with(&format!("{key}:")) {
            let value = line[key.len() + 1..].trim();
            // Strip surrounding quotes
            let value = value
                .trim_start_matches('"')
                .trim_end_matches('"')
                .trim_start_matches('\'')
                .trim_end_matches('\'');
            return Some(value.to_string());
        }
    }
    None
}

/// Extract tags array from YAML frontmatter.
pub fn extract_yaml_tags(yaml: &str) -> Vec<String> {
    let mut tags = Vec::new();
    let mut in_tags = false;
    for line in yaml.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("tags:") {
            let inline = trimmed["tags:".len()..].trim();
            // Handle inline array: tags: ["a", "b"]
            if inline.starts_with('[') {
                let inner = inline.trim_start_matches('[').trim_end_matches(']');
                for item in inner.split(',') {
                    let item = item.trim().trim_matches('"').trim_matches('\'');
                    if !item.is_empty() {
                        tags.push(item.to_string());
                    }
                }
                return tags;
            }
            // Handle empty: tags: []
            if inline == "[]" {
                return tags;
            }
            in_tags = true;
            continue;
        }
        if in_tags {
            if trimmed.starts_with("- ") {
                let item = trimmed[2..].trim().trim_matches('"').trim_matches('\'');
                if !item.is_empty() {
                    tags.push(item.to_string());
                }
            } else {
                break; // Next key encountered
            }
        }
    }
    tags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_filename() {
        assert_eq!(sanitize_filename("Hello World"), "Hello World");
        assert_eq!(sanitize_filename("a/b\\c:d"), "a-b-c-d");
        assert_eq!(sanitize_filename(""), "untitled");
        assert_eq!(sanitize_filename("***"), "untitled");
    }

    #[test]
    fn test_compute_content_hash() {
        let hash = compute_content_hash("hello");
        assert!(hash.starts_with("sha256:"));
        assert_eq!(hash.len(), 7 + 64); // "sha256:" + 64 hex chars
    }

    #[test]
    fn test_parse_frontmatter() {
        let content = "---\ntitle: test\n---\n\nBody content";
        let (yaml, body) = parse_frontmatter(content).unwrap();
        assert_eq!(yaml, "title: test");
        assert_eq!(body, "Body content");
    }

    #[test]
    fn test_extract_yaml_field() {
        let yaml = "id: \"abc-123\"\ncategory: fact\nimportance: 3";
        assert_eq!(extract_yaml_field(yaml, "id"), Some("abc-123".into()));
        assert_eq!(extract_yaml_field(yaml, "category"), Some("fact".into()));
        assert_eq!(extract_yaml_field(yaml, "importance"), Some("3".into()));
        assert_eq!(extract_yaml_field(yaml, "missing"), None);
    }

    #[test]
    fn test_extract_yaml_tags() {
        let yaml = "tags:\n  - \"tag1\"\n  - \"tag2\"";
        assert_eq!(extract_yaml_tags(yaml), vec!["tag1", "tag2"]);

        let yaml2 = "tags: [\"a\", \"b\"]";
        assert_eq!(extract_yaml_tags(yaml2), vec!["a", "b"]);

        let yaml3 = "tags: []";
        assert!(extract_yaml_tags(yaml3).is_empty());
    }
}
