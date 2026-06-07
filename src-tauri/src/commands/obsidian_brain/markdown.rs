use sha2::{Digest, Sha256};

use crate::db::models::{ConnectorDefinition, Persona, PersonaMemory};

/// Emit a value as a correctly escaped YAML double-quoted scalar (including the
/// surrounding quotes).
///
/// User-controlled fields (persona name, memory id/title, descriptions, etc.)
/// are interpolated into YAML frontmatter. Naively wrapping them in `"{value}"`
/// breaks the round-trip whenever the value contains a `"`, `\`, `:` or a
/// newline (e.g. a persona named `Acme "Pro"` produced `persona: "Acme "Pro""`,
/// which the reader then mis-parsed). YAML double-quoted scalars use C-style
/// escapes, so we escape the backslash first, then the quote, then the control
/// characters per the YAML 1.2 double-quoted rules. Newlines/tabs are encoded
/// as escape sequences so every frontmatter value stays on a single line, which
/// keeps the line-oriented reader in `extract_yaml_field` correct.
pub fn yaml_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('"');
    for c in value.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            // Other C0 control chars are illegal unescaped in a YAML scalar;
            // emit them as a 2-digit `\xNN` escape (valid YAML, < 0x100).
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

/// Reverse `yaml_quote`: un-escape a YAML double-quoted scalar back to its raw
/// string. The surrounding quotes are assumed already stripped by the caller.
/// Handles the escapes we emit (`\\`, `\"`, `\n`, `\r`, `\t`, `\xNN`) and leaves
/// any unrecognised escape's payload untouched.
fn yaml_unescape(value: &str) -> String {
    if !value.contains('\\') {
        return value.to_string();
    }
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('\\') => out.push('\\'),
            Some('"') => out.push('"'),
            Some('n') => out.push('\n'),
            Some('r') => out.push('\r'),
            Some('t') => out.push('\t'),
            Some('0') => out.push('\0'),
            Some('x') => {
                // Two hex digits -> single byte/codepoint.
                let h: String = chars.by_ref().take(2).collect();
                if let Ok(code) = u32::from_str_radix(&h, 16) {
                    if let Some(ch) = char::from_u32(code) {
                        out.push(ch);
                    }
                } else {
                    // Not a valid \xNN escape — keep the literal payload.
                    out.push('x');
                    out.push_str(&h);
                }
            }
            // Unknown escape: drop the backslash, keep the following char.
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

/// Convert a PersonaMemory to an Obsidian-compatible markdown file with YAML frontmatter.
pub fn memory_to_markdown(memory: &PersonaMemory, persona_name: &str) -> String {
    let tags_yaml = match &memory.tags {
        Some(tags) if !tags.0.is_empty() => {
            let items: Vec<String> = tags
                .0
                .iter()
                .map(|t| format!("  - {}", yaml_quote(t)))
                .collect();
            format!("tags:\n{}", items.join("\n"))
        }
        _ => "tags: []".into(),
    };

    format!(
        r#"---
id: {id}
persona: {persona}
category: {category}
importance: {importance}
tier: {tier}
{tags}
type: "persona-memory"
created: {created}
updated: {updated}
---

# {title}

{content}
"#,
        // Frontmatter scalars are escaped so user-controlled values round-trip.
        id = yaml_quote(&memory.id),
        persona = yaml_quote(persona_name),
        category = yaml_quote(&memory.category),
        importance = memory.importance,
        tier = yaml_quote(&memory.tier),
        tags = tags_yaml,
        created = yaml_quote(&memory.created_at),
        updated = yaml_quote(&memory.updated_at),
        // title/content live in the markdown body, not the YAML frontmatter.
        title = memory.title,
        content = memory.content,
    )
}

/// Convert a Persona to an Obsidian-compatible markdown profile document.
pub fn persona_to_markdown(persona: &Persona) -> String {
    let desc = persona.description.as_deref().unwrap_or("No description");
    let model = persona.model_profile.as_deref().unwrap_or("default");

    format!(
        r#"---
id: {id}
type: "persona-profile"
enabled: {enabled}
model_profile: {model_fm}
trust_level: {trust_level_fm}
trust_score: {trust_score}
max_concurrent: {max_concurrent}
timeout_ms: {timeout_ms}
created: {created}
updated: {updated}
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
        // Frontmatter scalars are escaped; the table/body below render raw.
        id = yaml_quote(&persona.id),
        name = persona.name,
        desc = desc,
        enabled = persona.enabled,
        model_fm = yaml_quote(model),
        model = model,
        trust_level_fm = yaml_quote(&persona.trust_level.to_string()),
        trust_level = persona.trust_level,
        trust_score = persona.trust_score,
        max_concurrent = persona.max_concurrent,
        timeout_ms = persona.timeout_ms,
        system_prompt = persona.system_prompt,
        created = yaml_quote(&persona.created_at),
        updated = yaml_quote(&persona.updated_at),
    )
}

/// Convert a ConnectorDefinition to an Obsidian-compatible markdown document.
pub fn connector_to_markdown(connector: &ConnectorDefinition) -> String {
    format!(
        r#"---
id: {id}
type: "connector"
category: {category_fm}
is_builtin: {is_builtin}
created: {created}
updated: {updated}
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
        // Frontmatter scalars are escaped; the body below renders raw.
        id = yaml_quote(&connector.id),
        name = connector.name,
        label = connector.label,
        category_fm = yaml_quote(&connector.category),
        category = connector.category,
        is_builtin = connector.is_builtin,
        services = connector.services,
        events = connector.events,
        created = yaml_quote(&connector.created_at),
        updated = yaml_quote(&connector.updated_at),
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
        crate::utils::text::truncate_on_char_boundary(&trimmed, 100)
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
///
/// Reverses what the `*_to_markdown` emitters produce: a double-quoted scalar is
/// unwrapped by stripping exactly one surrounding quote and then un-escaping the
/// C-style escapes (the inverse of [`yaml_quote`]). Single-quoted and bare
/// (unquoted) values still parse, so older/hand-written notes keep working.
pub fn extract_yaml_field(yaml: &str, key: &str) -> Option<String> {
    for line in yaml.lines() {
        let line = line.trim();
        if line.starts_with(&format!("{key}:")) {
            let value = line[key.len() + 1..].trim();
            return Some(unquote_yaml_scalar(value));
        }
    }
    None
}

/// Unwrap a YAML scalar token: a double-quoted value is un-escaped, a
/// single-quoted value has its quotes removed (YAML single-quotes only escape
/// `''` -> `'`), and a bare value is returned as-is. An unterminated or empty
/// quote falls through to the raw text so we never panic on malformed input.
fn unquote_yaml_scalar(value: &str) -> String {
    let bytes = value.as_bytes();
    if value.len() >= 2 && bytes[0] == b'"' && bytes[value.len() - 1] == b'"' {
        // Strip exactly one quote from each end, then reverse the escapes.
        return yaml_unescape(&value[1..value.len() - 1]);
    }
    if value.len() >= 2 && bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'' {
        return value[1..value.len() - 1].replace("''", "'");
    }
    value.to_string()
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
                    let item = unquote_yaml_scalar(item.trim());
                    if !item.is_empty() {
                        tags.push(item);
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
                let item = unquote_yaml_scalar(trimmed[2..].trim());
                if !item.is_empty() {
                    tags.push(item);
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
    fn test_yaml_quote_escapes() {
        assert_eq!(yaml_quote("plain"), "\"plain\"");
        assert_eq!(yaml_quote("Acme \"Pro\""), "\"Acme \\\"Pro\\\"\"");
        assert_eq!(yaml_quote("a\\b"), "\"a\\\\b\"");
        assert_eq!(yaml_quote("line1\nline2"), "\"line1\\nline2\"");
        assert_eq!(yaml_quote("tab\there"), "\"tab\\there\"");
    }

    #[test]
    fn test_yaml_quote_roundtrip() {
        // The exact failure from the bug report: a quoted persona name must
        // survive emit -> parse intact so the pull-sync name lookup matches.
        for raw in [
            "Acme \"Pro\"",
            "key: value with colon",
            "back\\slash",
            "multi\nline\ttext",
            "trailing quote\"",
            "",
            "normal name",
        ] {
            let yaml = format!("persona: {}", yaml_quote(raw));
            assert_eq!(
                extract_yaml_field(&yaml, "persona").as_deref(),
                Some(raw),
                "round-trip failed for {raw:?}"
            );
        }
    }

    #[test]
    fn test_extract_yaml_field_legacy_unquoted() {
        // Old/hand-written notes with bare or single-quoted values still parse.
        let yaml = "category: fact\ntier: 'short'";
        assert_eq!(extract_yaml_field(yaml, "category"), Some("fact".into()));
        assert_eq!(extract_yaml_field(yaml, "tier"), Some("short".into()));
    }

    #[test]
    fn test_extract_yaml_tags_escaped() {
        let yaml = format!("tags:\n  - {}", yaml_quote("has \"quote\""));
        assert_eq!(extract_yaml_tags(&yaml), vec!["has \"quote\""]);
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
