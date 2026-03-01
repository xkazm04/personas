use serde::{Deserialize, Serialize};

/// Section kinds for streaming section-by-section transform output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SectionKind {
    Identity,
    Prompt,
    Tool,
    Trigger,
    Connector,
    DesignContext,
}

#[allow(dead_code)]
impl SectionKind {
    pub fn from_marker(s: &str) -> Option<Self> {
        match s {
            "identity" => Some(Self::Identity),
            "prompt" => Some(Self::Prompt),
            "tool" => Some(Self::Tool),
            "trigger" => Some(Self::Trigger),
            "connector" => Some(Self::Connector),
            "design_context" => Some(Self::DesignContext),
            _ => None,
        }
    }

    pub fn label(&self) -> &'static str {
        match self {
            Self::Identity => "Identity",
            Self::Prompt => "System Prompt",
            Self::Tool => "Tool",
            Self::Trigger => "Trigger",
            Self::Connector => "Connector",
            Self::DesignContext => "Design Context",
        }
    }
}

/// Validation result for a streamed section.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SectionValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

#[allow(dead_code)]
impl SectionValidation {
    pub fn ok() -> Self {
        Self { valid: true, errors: vec![], warnings: vec![] }
    }
}

/// A single streamed section with its parsed data and validation status.
#[derive(Debug, Clone, Serialize)]
pub struct StreamingSection {
    pub kind: SectionKind,
    pub index: usize,
    pub label: String,
    pub data: serde_json::Value,
    pub validation: SectionValidation,
}

/// Accumulates streaming text and detects section boundaries.
///
/// Feed extracted display-text lines one at a time. When a new section delimiter
/// is encountered, the previous section is flushed, parsed, validated, and returned.
pub struct SectionAccumulator {
    current_kind: Option<SectionKind>,
    buffer: String,
    known_connectors: Vec<String>,
    tool_count: usize,
    trigger_count: usize,
    connector_count: usize,
    pub sections: Vec<StreamingSection>,
}

const SECTION_PREFIX: &str = "---SECTION:";
const SECTION_SUFFIX: &str = "---";

impl SectionAccumulator {
    pub fn new(known_connectors: Vec<String>) -> Self {
        Self {
            current_kind: None,
            buffer: String::new(),
            known_connectors,
            tool_count: 0,
            trigger_count: 0,
            connector_count: 0,
            sections: Vec::new(),
        }
    }

    /// Feed a line of extracted display text. Returns a completed section if a
    /// section boundary was crossed.
    pub fn feed_line(&mut self, line: &str) -> Option<StreamingSection> {
        let trimmed = line.trim();

        // Check for end marker
        if trimmed == "---SECTION:end---" {
            let completed = self.flush_current();
            self.current_kind = None;
            self.buffer.clear();
            return completed;
        }

        // Check for section delimiter
        if let Some(kind) = Self::parse_delimiter(trimmed) {
            let completed = self.flush_current();
            self.current_kind = Some(kind);
            self.buffer.clear();
            return completed;
        }

        // Accumulate text into the current section buffer
        if self.current_kind.is_some() && !trimmed.is_empty() {
            if !self.buffer.is_empty() {
                self.buffer.push('\n');
            }
            self.buffer.push_str(trimmed);
        }

        None
    }

    /// Flush any remaining buffered content as a completed section.
    pub fn flush(&mut self) -> Option<StreamingSection> {
        self.flush_current()
    }

    /// Returns true if any section delimiters were detected during streaming.
    pub fn has_sections(&self) -> bool {
        !self.sections.is_empty()
    }

    fn parse_delimiter(line: &str) -> Option<SectionKind> {
        let stripped = line.trim_start_matches(|c: char| c.is_whitespace());
        if !stripped.starts_with(SECTION_PREFIX) || !stripped.ends_with(SECTION_SUFFIX) {
            return None;
        }
        let inner = &stripped[SECTION_PREFIX.len()..stripped.len() - SECTION_SUFFIX.len()];
        if inner == "end" {
            return None;
        }
        SectionKind::from_marker(inner)
    }

    fn flush_current(&mut self) -> Option<StreamingSection> {
        let kind = self.current_kind.clone()?;
        let text = self.buffer.trim().to_string();
        if text.is_empty() {
            return None;
        }

        // Try to parse JSON from the accumulated text
        let data = Self::extract_json(&text);

        if data.is_null() {
            let section = StreamingSection {
                label: self.build_label(&kind, &serde_json::Value::Null),
                kind: kind.clone(),
                index: self.next_index(&kind),
                data: serde_json::Value::Null,
                validation: SectionValidation {
                    valid: false,
                    errors: vec!["Failed to parse section JSON".into()],
                    warnings: vec![],
                },
            };
            self.sections.push(section.clone());
            return Some(section);
        }

        let validation = self.validate(&kind, &data);
        let label = self.build_label(&kind, &data);
        let index = self.next_index(&kind);

        let section = StreamingSection {
            kind,
            index,
            label,
            data,
            validation,
        };
        self.sections.push(section.clone());
        Some(section)
    }

    fn extract_json(text: &str) -> serde_json::Value {
        // Direct parse
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(text) {
            return v;
        }
        // Strip markdown fences
        let cleaned = text
            .replace("```json", "")
            .replace("```", "")
            .trim()
            .to_string();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&cleaned) {
            return v;
        }
        // Use the existing balanced-brace JSON extractor
        if let Some(json_str) = super::cli_runner::extract_first_json_object(text) {
            if let Ok(v) = serde_json::from_str(&json_str) {
                return v;
            }
        }
        serde_json::Value::Null
    }

    fn next_index(&mut self, kind: &SectionKind) -> usize {
        match kind {
            SectionKind::Tool => {
                let i = self.tool_count;
                self.tool_count += 1;
                i
            }
            SectionKind::Trigger => {
                let i = self.trigger_count;
                self.trigger_count += 1;
                i
            }
            SectionKind::Connector => {
                let i = self.connector_count;
                self.connector_count += 1;
                i
            }
            _ => 0,
        }
    }

    fn build_label(&self, kind: &SectionKind, data: &serde_json::Value) -> String {
        let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("");
        match kind {
            SectionKind::Identity => {
                if name.is_empty() {
                    "Identity".to_string()
                } else {
                    format!("Identity: {}", name)
                }
            }
            SectionKind::Prompt => "System Prompt".to_string(),
            SectionKind::Tool => {
                if name.is_empty() {
                    format!("Tool #{}", self.tool_count + 1)
                } else {
                    format!("Tool: {}", name)
                }
            }
            SectionKind::Trigger => {
                let tt = data
                    .get("trigger_type")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                format!("Trigger: {}", tt)
            }
            SectionKind::Connector => {
                if name.is_empty() {
                    format!("Connector #{}", self.connector_count + 1)
                } else {
                    format!("Connector: {}", name)
                }
            }
            SectionKind::DesignContext => "Design Context".to_string(),
        }
    }

    fn validate(&self, kind: &SectionKind, data: &serde_json::Value) -> SectionValidation {
        match kind {
            SectionKind::Identity => validate_identity(data),
            SectionKind::Prompt => validate_prompt(data),
            SectionKind::Tool => validate_tool(data, &self.known_connectors),
            SectionKind::Trigger => validate_trigger(data),
            SectionKind::Connector => validate_connector(data),
            SectionKind::DesignContext => validate_design_context(data),
        }
    }

    /// Assemble all valid sections into a final N8nPersonaOutput.
    /// Returns None if required sections (identity + prompt) are missing.
    pub fn assemble(&self, workflow_name: &str) -> Option<super::types::N8nPersonaOutput> {
        let identity = self
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Identity)?;
        let prompt = self
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::Prompt)?;

        let tools: Vec<super::types::N8nToolDraft> = self
            .sections
            .iter()
            .filter(|s| s.kind == SectionKind::Tool && s.validation.valid)
            .filter_map(|s| serde_json::from_value(s.data.clone()).ok())
            .collect();

        let triggers: Vec<super::types::N8nTriggerDraft> = self
            .sections
            .iter()
            .filter(|s| s.kind == SectionKind::Trigger && s.validation.valid)
            .filter_map(|s| serde_json::from_value(s.data.clone()).ok())
            .collect();

        let connectors: Vec<super::types::N8nConnectorRef> = self
            .sections
            .iter()
            .filter(|s| s.kind == SectionKind::Connector && s.validation.valid)
            .filter_map(|s| serde_json::from_value(s.data.clone()).ok())
            .collect();

        let design_context = self
            .sections
            .iter()
            .find(|s| s.kind == SectionKind::DesignContext)
            .and_then(|s| serde_json::to_string(&s.data).ok());

        let system_prompt = prompt
            .data
            .get("system_prompt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let structured_prompt = prompt.data.get("structured_prompt").cloned();

        let output = super::types::N8nPersonaOutput {
            name: identity
                .data
                .get("name")
                .and_then(|v| v.as_str())
                .map(String::from),
            description: identity
                .data
                .get("description")
                .and_then(|v| v.as_str())
                .map(String::from),
            system_prompt,
            structured_prompt,
            icon: identity
                .data
                .get("icon")
                .and_then(|v| v.as_str())
                .map(String::from),
            color: identity
                .data
                .get("color")
                .and_then(|v| v.as_str())
                .map(String::from),
            model_profile: identity
                .data
                .get("model_profile")
                .and_then(|v| v.as_str())
                .map(String::from),
            max_budget_usd: identity
                .data
                .get("max_budget_usd")
                .and_then(|v| v.as_f64()),
            max_turns: identity
                .data
                .get("max_turns")
                .and_then(|v| v.as_i64())
                .map(|v| v as i32),
            design_context,
            notification_channels: None,
            triggers: if triggers.is_empty() {
                None
            } else {
                Some(triggers)
            },
            tools: if tools.is_empty() { None } else { Some(tools) },
            required_connectors: if connectors.is_empty() {
                None
            } else {
                Some(connectors)
            },
        };

        Some(super::types::normalize_n8n_persona_draft(
            output,
            workflow_name,
        ))
    }
}

// ── Section Validation ──────────────────────────────────────────

fn validate_identity(data: &serde_json::Value) -> SectionValidation {
    let mut warnings = vec![];

    if data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warnings.push("Missing persona name — will use workflow name".into());
    }

    if data
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warnings.push("Missing description".into());
    }

    SectionValidation {
        valid: true,
        errors: vec![],
        warnings,
    }
}

fn validate_prompt(data: &serde_json::Value) -> SectionValidation {
    let mut errors = vec![];
    let mut warnings = vec![];

    let sys = data
        .get("system_prompt")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if sys.trim().is_empty() {
        errors.push("System prompt is empty".into());
    } else if sys.len() < 100 {
        warnings.push("System prompt seems very short".into());
    }

    if data.get("structured_prompt").is_none() {
        warnings.push("No structured prompt sections".into());
    }

    SectionValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn validate_tool(data: &serde_json::Value, known_connectors: &[String]) -> SectionValidation {
    let mut errors = vec![];
    let mut warnings = vec![];

    let name = data.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if name.trim().is_empty() {
        errors.push("Tool name is empty".into());
    }

    if data
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warnings.push("Tool missing description".into());
    }

    if data
        .get("implementation_guide")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warnings.push("Missing implementation_guide — execution may fail".into());
    }

    // Validate connector reference against known connectors
    if let Some(cred_type) = data
        .get("requires_credential_type")
        .and_then(|v| v.as_str())
    {
        if !cred_type.is_empty()
            && !known_connectors
                .iter()
                .any(|c| c.eq_ignore_ascii_case(cred_type))
        {
            warnings.push(format!(
                "References unknown connector '{}'",
                cred_type
            ));
        }
    }

    SectionValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn validate_trigger(data: &serde_json::Value) -> SectionValidation {
    let mut errors = vec![];
    let mut warnings = vec![];

    let trigger_type = data
        .get("trigger_type")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let valid_types = ["schedule", "polling", "webhook", "manual"];
    if !valid_types.contains(&trigger_type) {
        errors.push(format!(
            "Invalid trigger type '{}' — must be one of: {}",
            trigger_type,
            valid_types.join(", ")
        ));
    }

    if trigger_type == "schedule" {
        if let Some(config) = data.get("config") {
            if config
                .get("cron")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .is_empty()
            {
                warnings.push("Schedule trigger missing cron expression".into());
            }
        }
    }

    SectionValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

fn validate_connector(data: &serde_json::Value) -> SectionValidation {
    let mut errors = vec![];

    if data
        .get("name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        errors.push("Connector name is empty".into());
    }

    SectionValidation {
        valid: errors.is_empty(),
        errors,
        warnings: vec![],
    }
}

fn validate_design_context(data: &serde_json::Value) -> SectionValidation {
    let mut warnings = vec![];

    if data
        .get("summary")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .is_empty()
    {
        warnings.push("Missing design context summary".into());
    }

    match data.get("use_cases").and_then(|v| v.as_array()) {
        None => warnings.push("No use cases defined".into()),
        Some(arr) if arr.is_empty() => warnings.push("Use cases array is empty".into()),
        _ => {}
    }

    SectionValidation {
        valid: true,
        errors: vec![],
        warnings,
    }
}

/// Extract known connector names from connector + credential JSON payloads.
/// Used to validate tool connector references during streaming.
pub fn extract_known_connectors(
    connectors_json: Option<&str>,
    credentials_json: Option<&str>,
) -> Vec<String> {
    let mut connectors = Vec::new();

    if let Some(cj) = connectors_json {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(cj) {
            for item in arr {
                if let Some(name) = item.get("name").and_then(|v| v.as_str()) {
                    connectors.push(name.to_lowercase());
                }
            }
        }
    }

    if let Some(cj) = credentials_json {
        if let Ok(arr) = serde_json::from_str::<Vec<serde_json::Value>>(cj) {
            for item in arr {
                if let Some(st) = item.get("service_type").and_then(|v| v.as_str()) {
                    if !connectors.iter().any(|c| c == &st.to_lowercase()) {
                        connectors.push(st.to_lowercase());
                    }
                }
            }
        }
    }

    connectors
}
