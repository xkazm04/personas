//! Template lookup — keyword similarity matching against the local template
//! catalog at `scripts/templates/`. Used by [`build_template_context`] to
//! inject a small "Reference Templates" section into the build prompt so the
//! LLM can pattern-match the user's intent against shipped persona templates.
//!
//! The index is loaded once and cached for the process lifetime — templates
//! don't change at runtime. Keyword extraction handles non-English intents by
//! falling back to substring scans for known service names ("gmail", "slack",
//! …) which are always written in ASCII regardless of the user's locale.

/// Lightweight template index entry for similarity matching.
#[derive(Clone)]
struct TemplateEntry {
    name: String,
    description: String,
    category: String,
    service_flow: Vec<String>,
}

/// Load template index from `scripts/templates/` — reads only the lightweight
/// fields (name, description, category, service_flow) from each JSON file.
/// Results are cached in-process after the first load.
fn load_template_index() -> Vec<TemplateEntry> {
    static CACHE: std::sync::LazyLock<Vec<TemplateEntry>> = std::sync::LazyLock::new(|| {
        let templates_dir = std::path::Path::new("scripts/templates");
        if !templates_dir.exists() {
            return vec![];
        }

        let mut entries = Vec::new();
        if let Ok(categories) = std::fs::read_dir(templates_dir) {
            for cat_entry in categories.flatten() {
                let cat_path = cat_entry.path();
                if !cat_path.is_dir() || cat_path.file_name().map(|n| n.to_string_lossy().starts_with('_')).unwrap_or(true) {
                    continue;
                }
                if let Ok(files) = std::fs::read_dir(&cat_path) {
                    for file_entry in files.flatten() {
                        let fp = file_entry.path();
                        if fp.extension().map(|e| e == "json").unwrap_or(false) {
                            if let Ok(content) = std::fs::read_to_string(&fp) {
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&content) {
                                    entries.push(TemplateEntry {
                                        name: val.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                        description: val.get("description").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                        category: val.get("category")
                                            .and_then(|v| v.as_array())
                                            .and_then(|a| a.first())
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("")
                                            .to_string(),
                                        service_flow: val.get("service_flow")
                                            .and_then(|v| v.as_array())
                                            .map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect())
                                            .unwrap_or_default(),
                                    });
                                }
                            }
                        }
                    }
                }
            }
        }
        tracing::info!("Template index loaded: {} entries (cached)", entries.len());
        entries
    });
    CACHE.clone()
}

/// Extract keywords from text: word splitting + known service name scanning.
///
/// For non-English intents, standard word splitting may fail (CJK has no
/// spaces, Arabic is joined), but service names like "Gmail", "Notion",
/// "Slack" are always written in ASCII regardless of language. The service
/// name scan finds these as substrings, ensuring template matching works for
/// all languages.
fn extract_keywords(text: &str) -> Vec<String> {
    let stopwords: std::collections::HashSet<&str> = [
        "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
        "of", "with", "by", "from", "is", "it", "that", "this", "be", "are",
        "was", "were", "been", "have", "has", "had", "do", "does", "did",
        "will", "would", "could", "should", "may", "might", "can", "shall",
        "i", "me", "my", "we", "our", "you", "your", "they", "their",
        "want", "need", "like", "make", "create", "build", "agent", "bot",
    ].into_iter().collect();

    // Standard word extraction (works for space-delimited languages).
    let mut keywords: Vec<String> = text.to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2 && !stopwords.contains(w))
        .map(|s| s.to_string())
        .collect();

    // Service name substring scan — finds "gmail" inside "Gmailのメール" etc.
    let known_services = [
        "gmail", "outlook", "notion", "slack", "discord", "trello", "jira",
        "asana", "github", "gitlab", "linear", "airtable", "google", "sheets",
        "drive", "calendar", "teams", "zoom", "hubspot", "salesforce",
        "stripe", "shopify", "sentry", "supabase", "clickup", "attio",
        "telegram", "whatsapp", "twilio", "sendgrid", "calcom",
    ];
    let text_lower = text.to_lowercase();
    for svc in &known_services {
        if text_lower.contains(svc) && !keywords.contains(&svc.to_string()) {
            keywords.push(svc.to_string());
        }
    }

    keywords
}

/// Find the top N templates most similar to the given intent by keyword
/// overlap score.
fn find_similar_templates<'a>(intent: &str, templates: &'a [TemplateEntry], top_n: usize) -> Vec<&'a TemplateEntry> {
    let intent_kw = extract_keywords(intent);
    if intent_kw.is_empty() {
        return vec![];
    }

    let mut scored: Vec<(usize, &TemplateEntry)> = templates.iter().map(|t| {
        let text = format!("{} {} {} {}", t.name, t.description, t.category, t.service_flow.join(" "));
        let tmpl_kw = extract_keywords(&text);
        let score = intent_kw.iter().filter(|kw| tmpl_kw.contains(kw)).count();
        (score, t)
    }).collect();

    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter()
        .filter(|(score, _)| *score > 0)
        .take(top_n)
        .map(|(_, t)| t)
        .collect()
}

/// Build a "Reference Templates" section for the build prompt from matched
/// templates. Returns an empty string when no template scores above zero so
/// the prompt isn't padded with a useless heading.
pub(super) fn build_template_context(intent: &str) -> String {
    let templates = load_template_index();
    if templates.is_empty() {
        return String::new();
    }

    let matches = find_similar_templates(intent, &templates, 3);
    if matches.is_empty() {
        return String::new();
    }

    let mut section = String::from("## Reference Templates\nThe following existing templates are similar to the user's intent. Use them as inspiration for dimension values, tool configurations, and service flows. Adapt — don't copy verbatim.\n\n");
    for (i, t) in matches.iter().enumerate() {
        section.push_str(&format!(
            "### Reference {}: {} ({})\n{}\nServices: {}\n\n",
            i + 1,
            t.name,
            t.category,
            t.description,
            t.service_flow.join(", "),
        ));
    }
    section
}
