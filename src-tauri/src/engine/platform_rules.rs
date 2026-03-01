//! Config-driven platform definitions for workflow import.
//!
//! Replaces hardcoded rules in prompts.rs and n8nParser.ts with a
//! data-driven PlatformDefinition structure. Each platform (n8n, Zapier,
//! Make) is defined as a JSON config that can be loaded from the database
//! or from built-in defaults.

use crate::db::models::PlatformDefinition;

// ============================================================================
// Built-in platform definitions
// ============================================================================

/// Built-in n8n platform definition.
pub fn builtin_n8n() -> PlatformDefinition {
    PlatformDefinition {
        id: "n8n".into(),
        label: "n8n".into(),
        format: "json".into(),
        node_type_map: vec![
            nt("gmail", "gmail"),
            nt("slack", "slack"),
            nt("github", "github"),
            nt("postgres", "postgres"),
            nt("notion", "notion"),
            nt("webhook", "webhook"),
            nt("cron", "schedule"),
            nt("schedule", "schedule"),
            nt("httprequest", "http"),
            nt("airtable", "airtable"),
            nt("googlesheets", "google-sheets"),
            nt("googledrive", "google-drive"),
            nt("googlecalendar", "google-calendar"),
            nt("discord", "discord"),
            nt("jira", "jira"),
            nt("telegram", "telegram"),
            nt("twitter", "twitter"),
            nt("dropbox", "dropbox"),
            nt("mongodb", "mongodb"),
            nt("mysql", "mysql"),
            nt("redis", "redis"),
            nt("s3", "aws-s3"),
            nt("sqs", "aws-sqs"),
            nt("stripe", "stripe"),
            nt("twilio", "twilio"),
            nt("sendgrid", "sendgrid"),
            nt("openai", "openai"),
            nt("hubspot", "hubspot"),
            nt("clickup", "clickup"),
            nt("asana", "asana"),
            nt("todoist", "todoist"),
            nt("linear", "linear"),
            nt("salesforce", "salesforce"),
            nt("zendesk", "zendesk"),
            nt("intercom", "intercom"),
            nt("mailchimp", "mailchimp"),
            nt("microsoftoutlook", "microsoft"),
            nt("microsoftonedrive", "microsoft"),
            nt("microsoftteams", "microsoft"),
        ],
        credential_consolidation: vec![
            cc(
                &["gmailOAuth2", "googleSheetsOAuth2Api", "googleCalendarOAuth2Api",
                  "googleDriveOAuth2Api", "google*"],
                "google",
                "All Google OAuth credential types → single 'google' connector",
            ),
            cc(
                &["slackOAuth2Api", "slackApi"],
                "slack",
                "All Slack credential types → single 'slack' connector",
            ),
            cc(
                &["microsoftOutlookOAuth2Api", "microsoftOneDriveOAuth2Api",
                  "microsoftTeamsOAuth2Api"],
                "microsoft",
                "All Microsoft credential types → single 'microsoft' connector",
            ),
        ],
        node_role_classification: vec![
            nr("trigger", "trigger"),
            nr("cron", "trigger"),
            nr("schedule", "trigger"),
            nr("webhook", "trigger"),
            nr("aiagent", "llm"),
            nr("llmchat", "llm"),
            nr("chatmodel", "llm"),
            nr("outputparser", "llm"),
            nr("openai", "llm"),
            nr("anthropic", "llm"),
            nr("if$", "decision"),
            nr("switch", "decision"),
            nr("filter", "decision"),
            nr("merge", "utility"),
            nr("set$", "utility"),
            nr("splitinbatches", "utility"),
            nr("function", "utility"),
            nr("code$", "utility"),
        ],
        excluded_credential_types: vec![
            "anthropicApi".into(),
            "openAiApi".into(),
        ],
        protocol_map_rules: vec![
            pm("Send email, post to Slack, modify database, or any externally-visible action",
               "manual_review",
               "Node performs external side-effects"),
            pm("Set variable, store data, extract information",
               "agent_memory",
               "Node captures or stores data for reuse"),
            pm("Wait node, Approval node, IF node requiring human judgment",
               "manual_review",
               "Node pauses for human confirmation"),
            pm("Webhook output, Execute Workflow, chain to other workflow",
               "emit_event",
               "Node triggers downstream workflows"),
            pm("Notification node, alert node, status update",
               "user_message",
               "Node sends notifications to users"),
        ],
        is_builtin: true,
    }
}

/// Built-in Zapier platform definition.
pub fn builtin_zapier() -> PlatformDefinition {
    PlatformDefinition {
        id: "zapier".into(),
        label: "Zapier".into(),
        format: "json".into(),
        node_type_map: vec![
            nt("gmail", "gmail"),
            nt("google-mail", "gmail"),
            nt("slack", "slack"),
            nt("github", "github"),
            nt("google-sheets", "google-sheets"),
            nt("google-drive", "google-drive"),
            nt("trello", "trello"),
            nt("asana", "asana"),
            nt("notion", "notion"),
            nt("airtable", "airtable"),
            nt("discord", "discord"),
            nt("jira", "jira"),
            nt("hubspot", "hubspot"),
            nt("mailchimp", "mailchimp"),
            nt("stripe", "stripe"),
            nt("twilio", "twilio"),
            nt("twitter", "twitter"),
            nt("dropbox", "dropbox"),
            nt("webhook", "webhook"),
            nt("schedule", "schedule"),
            nt("formatter", "formatter"),
            nt("filter", "filter"),
            nt("code", "code"),
            nt("salesforce", "salesforce"),
            nt("zendesk", "zendesk"),
            nt("intercom", "intercom"),
            nt("todoist", "todoist"),
            nt("clickup", "clickup"),
            nt("linear", "linear"),
        ],
        credential_consolidation: vec![
            cc(
                &["gmail", "google-mail", "google-sheets", "google-drive",
                  "google-calendar", "google-contacts", "google*"],
                "google",
                "All Zapier Google app types → single 'google' connector",
            ),
            cc(
                &["slack", "slack-*"],
                "slack",
                "All Zapier Slack app types → single 'slack' connector",
            ),
            cc(
                &["microsoft-outlook", "microsoft-onedrive", "microsoft-teams",
                  "microsoft-*"],
                "microsoft",
                "All Zapier Microsoft app types → single 'microsoft' connector",
            ),
        ],
        node_role_classification: vec![
            nr("trigger", "trigger"),
            nr("schedule", "trigger"),
            nr("webhook", "trigger"),
            nr("formatter", "utility"),
            nr("filter", "decision"),
            nr("code", "utility"),
            nr("paths", "decision"),
            nr("delay", "utility"),
        ],
        excluded_credential_types: vec![
            "openai".into(),
            "chatgpt".into(),
        ],
        protocol_map_rules: vec![
            pm("Send email, post message, create record in external service",
               "manual_review",
               "Step performs external side-effects"),
            pm("Formatter, lookup, search, read data",
               "agent_memory",
               "Step processes or extracts reusable data"),
            pm("Delay step, approval step, filter with human judgment",
               "manual_review",
               "Step pauses for human confirmation"),
            pm("Webhook output, trigger another Zap",
               "emit_event",
               "Step triggers downstream Zaps"),
            pm("Email notification, Slack message, SMS alert",
               "user_message",
               "Step sends notifications"),
        ],
        is_builtin: true,
    }
}

/// Built-in Make (Integromat) platform definition.
pub fn builtin_make() -> PlatformDefinition {
    PlatformDefinition {
        id: "make".into(),
        label: "Make (Integromat)".into(),
        format: "json".into(),
        node_type_map: vec![
            nt("google", "google"),
            nt("gmail", "gmail"),
            nt("google-sheets", "google-sheets"),
            nt("google-drive", "google-drive"),
            nt("slack", "slack"),
            nt("github", "github"),
            nt("notion", "notion"),
            nt("airtable", "airtable"),
            nt("discord", "discord"),
            nt("jira", "jira"),
            nt("hubspot", "hubspot"),
            nt("mailchimp", "mailchimp"),
            nt("stripe", "stripe"),
            nt("twilio", "twilio"),
            nt("twitter", "twitter"),
            nt("dropbox", "dropbox"),
            nt("http", "http"),
            nt("webhook", "webhook"),
            nt("json", "json"),
            nt("csv", "csv"),
            nt("email", "email"),
            nt("ftp", "ftp"),
            nt("mysql", "mysql"),
            nt("postgres", "postgres"),
            nt("mongodb", "mongodb"),
            nt("salesforce", "salesforce"),
        ],
        credential_consolidation: vec![
            cc(
                &["google:*", "gmail:*", "google-sheets:*", "google-drive:*"],
                "google",
                "All Make Google module types → single 'google' connector",
            ),
            cc(
                &["slack:*"],
                "slack",
                "All Make Slack module types → single 'slack' connector",
            ),
            cc(
                &["microsoft-*:*"],
                "microsoft",
                "All Make Microsoft module types → single 'microsoft' connector",
            ),
        ],
        node_role_classification: vec![
            nr("trigger", "trigger"),
            nr("watch", "trigger"),
            nr("webhook", "trigger"),
            nr("instant", "trigger"),
            nr("router", "decision"),
            nr("filter", "decision"),
            nr("json", "utility"),
            nr("csv", "utility"),
            nr("builtin:router", "decision"),
        ],
        excluded_credential_types: vec![
            "openai:*".into(),
        ],
        protocol_map_rules: vec![
            pm("Module creates, updates, or sends to external service",
               "manual_review",
               "Module performs external side-effects"),
            pm("Module reads, searches, or transforms data",
               "agent_memory",
               "Module processes or extracts reusable data"),
            pm("Webhook output, trigger another scenario",
               "emit_event",
               "Module triggers downstream scenarios"),
            pm("Email, Slack, notification modules",
               "user_message",
               "Module sends notifications"),
        ],
        is_builtin: true,
    }
}

/// Get all built-in platform definitions.
pub fn builtin_definitions() -> Vec<PlatformDefinition> {
    vec![builtin_n8n(), builtin_zapier(), builtin_make()]
}

/// Look up a platform definition by ID from the builtins.
pub fn get_builtin(platform_id: &str) -> Option<PlatformDefinition> {
    builtin_definitions().into_iter().find(|d| d.id == platform_id)
}

// ============================================================================
// Prompt composition helpers
// ============================================================================

#[allow(dead_code)]
impl PlatformDefinition {
    /// Generate the credential consolidation rules section for the AI prompt.
    pub fn format_credential_rules_prompt(&self) -> String {
        if self.credential_consolidation.is_empty() {
            return String::new();
        }

        let mut lines = vec![
            format!("## Credential Mapping Rules (CRITICAL for tool generation)"),
            format!("{} uses separate credential types per service feature, but Personas consolidates them under", self.label),
            "a single OAuth connector per provider. You MUST map accordingly:\n".into(),
            "Consolidation rules:".into(),
        ];

        for rule in &self.credential_consolidation {
            let sources = rule.source_patterns.iter()
                .map(|s| format!("\"{}\"", s))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("- {} → single connector \"{}\"", sources, rule.target_connector));
        }

        if !self.excluded_credential_types.is_empty() {
            let excluded = self.excluded_credential_types.iter()
                .map(|s| format!("\"{}\"", s))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("- {} → NOT mapped (Personas has built-in LLM)", excluded));
        }

        lines.push("- For other credential types, map to the closest connector by service name".into());
        lines.join("\n")
    }

    /// Generate the node role classification section for prompts.
    pub fn format_node_roles_prompt(&self) -> String {
        if self.node_role_classification.is_empty() {
            return String::new();
        }

        let mut lines = vec![
            format!("\n## {} Node Classification", self.label),
        ];

        let mut roles: std::collections::HashMap<&str, Vec<&str>> = std::collections::HashMap::new();
        for nrp in &self.node_role_classification {
            roles.entry(&nrp.role).or_default().push(&nrp.pattern);
        }

        for (role, patterns) in &roles {
            let pats = patterns.iter()
                .map(|p| format!("/{}/i", p))
                .collect::<Vec<_>>()
                .join(", ");
            lines.push(format!("- **{}** nodes: {}", role, pats));
        }

        lines.join("\n")
    }

    /// Generate the protocol mapping section for prompts.
    pub fn format_protocol_rules_prompt(&self) -> String {
        if self.protocol_map_rules.is_empty() {
            return String::new();
        }

        let mut lines = vec![
            format!("\n## {} → Persona Protocol Mapping", self.label),
        ];

        for rule in &self.protocol_map_rules {
            lines.push(format!("- {} → `{}` ({})",
                rule.platform_pattern,
                rule.target_protocol,
                rule.condition));
        }

        lines.join("\n")
    }

    /// Serialize to JSON for DB storage.
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Deserialize from JSON (DB storage).
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }

    /// Resolve a node type to its target service name using node_type_map.
    pub fn resolve_node_type(&self, node_type: &str) -> Option<&str> {
        let lower = node_type.to_lowercase();
        // Strip platform prefix (e.g., "n8n-nodes-base.gmailTrigger" → "gmailtrigger")
        let name = lower.rsplit('.').next().unwrap_or(&lower);
        // Remove common suffixes
        let cleaned = name
            .trim_end_matches("trigger")
            .trim_end_matches("node");

        for mapping in &self.node_type_map {
            if cleaned.starts_with(&mapping.source_pattern) || cleaned == mapping.source_pattern {
                return Some(&mapping.target_service);
            }
        }
        None
    }

    /// Resolve a credential type to its consolidated connector name.
    pub fn resolve_credential(&self, cred_type: &str) -> Option<&str> {
        let lower = cred_type.to_lowercase();

        // Check excluded first
        for excluded in &self.excluded_credential_types {
            if excluded.ends_with('*') {
                let prefix = &excluded[..excluded.len() - 1].to_lowercase();
                if lower.starts_with(prefix) {
                    return None; // Excluded
                }
            } else if lower == excluded.to_lowercase() {
                return None;
            }
        }

        // Check consolidation rules
        for rule in &self.credential_consolidation {
            for pattern in &rule.source_patterns {
                if pattern.ends_with('*') {
                    let prefix = pattern[..pattern.len() - 1].to_lowercase();
                    if lower.starts_with(&*prefix) {
                        return Some(&rule.target_connector);
                    }
                } else if lower == pattern.to_lowercase() {
                    return Some(&rule.target_connector);
                }
            }
        }

        None
    }

    /// Classify a node's role based on node_role_classification patterns.
    pub fn classify_node_role(&self, node_type: &str) -> &str {
        let lower = node_type.to_lowercase();
        for nrp in &self.node_role_classification {
            if lower.contains(&nrp.pattern.to_lowercase()) {
                return &nrp.role;
            }
        }
        "tool" // default role
    }
}

// ============================================================================
// Helper constructors
// ============================================================================

fn nt(source: &str, target: &str) -> crate::db::models::NodeTypeMapping {
    crate::db::models::NodeTypeMapping {
        source_pattern: source.into(),
        target_service: target.into(),
    }
}

fn cc(sources: &[&str], target: &str, desc: &str) -> crate::db::models::CredentialConsolidationRule {
    crate::db::models::CredentialConsolidationRule {
        source_patterns: sources.iter().map(|s| s.to_string()).collect(),
        target_connector: target.into(),
        description: desc.into(),
    }
}

fn nr(pattern: &str, role: &str) -> crate::db::models::NodeRolePattern {
    crate::db::models::NodeRolePattern {
        pattern: pattern.into(),
        role: role.into(),
    }
}

fn pm(pattern: &str, protocol: &str, condition: &str) -> crate::db::models::ProtocolMapRule {
    crate::db::models::ProtocolMapRule {
        platform_pattern: pattern.into(),
        target_protocol: protocol.into(),
        condition: condition.into(),
    }
}
