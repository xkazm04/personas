//! Config-driven platform definitions for workflow import.
//!
//! Replaces hardcoded rules in prompts.rs and n8nParser.ts with a
//! data-driven PlatformDefinition structure. Each platform (n8n, Zapier,
//! Make) is defined as a JSON config that can be loaded from the database
//! or from built-in defaults.

use std::sync::LazyLock;

use personas_db::models::{PlatformDefinition, PlatformFormat};

// ============================================================================
// Cached built-in platform definitions (built once, reused on every IPC call)
// ============================================================================

static BUILTIN_DEFS: LazyLock<Vec<PlatformDefinition>> =
    LazyLock::new(|| vec![builtin_n8n(), builtin_zapier(), builtin_make()]);

// ============================================================================
// Built-in platform definitions
// ============================================================================

/// Built-in n8n platform definition.
pub fn builtin_n8n() -> PlatformDefinition {
    PlatformDefinition {
        id: "n8n".into(),
        label: "n8n".into(),
        format: PlatformFormat::Json,
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
                &[
                    "gmailOAuth2",
                    "googleSheetsOAuth2Api",
                    "googleCalendarOAuth2Api",
                    "googleDriveOAuth2Api",
                    "google*",
                ],
                "google",
                "All Google OAuth credential types -> single 'google' connector",
            ),
            cc(
                &["slackOAuth2Api", "slackApi"],
                "slack",
                "All Slack credential types -> single 'slack' connector",
            ),
            cc(
                &[
                    "microsoftOutlookOAuth2Api",
                    "microsoftOneDriveOAuth2Api",
                    "microsoftTeamsOAuth2Api",
                ],
                "microsoft",
                "All Microsoft credential types -> single 'microsoft' connector",
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
        excluded_credential_types: vec!["anthropicApi".into(), "openAiApi".into()],
        protocol_map_rules: vec![
            pm(
                "Send email, post to Slack, modify database, or any externally-visible action",
                "manual_review",
                "Node performs external side-effects",
            ),
            pm(
                "Set variable, store data, extract information",
                "agent_memory",
                "Node captures or stores data for reuse",
            ),
            pm(
                "Wait node, Approval node, IF node requiring human judgment",
                "manual_review",
                "Node pauses for human confirmation",
            ),
            pm(
                "Webhook output, Execute Workflow, chain to other workflow",
                "emit_event",
                "Node triggers downstream workflows",
            ),
            pm(
                "Notification node, alert node, status update",
                "user_message",
                "Node sends notifications to users",
            ),
        ],
        is_builtin: true,
    }
}

/// Built-in Zapier platform definition.
pub fn builtin_zapier() -> PlatformDefinition {
    PlatformDefinition {
        id: "zapier".into(),
        label: "Zapier".into(),
        format: PlatformFormat::Json,
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
                &[
                    "gmail",
                    "google-mail",
                    "google-sheets",
                    "google-drive",
                    "google-calendar",
                    "google-contacts",
                    "google*",
                ],
                "google",
                "All Zapier Google app types -> single 'google' connector",
            ),
            cc(
                &["slack", "slack-*"],
                "slack",
                "All Zapier Slack app types -> single 'slack' connector",
            ),
            cc(
                &[
                    "microsoft-outlook",
                    "microsoft-onedrive",
                    "microsoft-teams",
                    "microsoft-*",
                ],
                "microsoft",
                "All Zapier Microsoft app types -> single 'microsoft' connector",
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
        excluded_credential_types: vec!["openai".into(), "chatgpt".into()],
        protocol_map_rules: vec![
            pm(
                "Send email, post message, create record in external service",
                "manual_review",
                "Step performs external side-effects",
            ),
            pm(
                "Formatter, lookup, search, read data",
                "agent_memory",
                "Step processes or extracts reusable data",
            ),
            pm(
                "Delay step, approval step, filter with human judgment",
                "manual_review",
                "Step pauses for human confirmation",
            ),
            pm(
                "Webhook output, trigger another Zap",
                "emit_event",
                "Step triggers downstream Zaps",
            ),
            pm(
                "Email notification, Slack message, SMS alert",
                "user_message",
                "Step sends notifications",
            ),
        ],
        is_builtin: true,
    }
}

/// Built-in Make (Integromat) platform definition.
pub fn builtin_make() -> PlatformDefinition {
    PlatformDefinition {
        id: "make".into(),
        label: "Make (Integromat)".into(),
        format: PlatformFormat::Json,
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
                "All Make Google module types -> single 'google' connector",
            ),
            cc(
                &["slack:*"],
                "slack",
                "All Make Slack module types -> single 'slack' connector",
            ),
            cc(
                &["microsoft-*:*"],
                "microsoft",
                "All Make Microsoft module types -> single 'microsoft' connector",
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
        excluded_credential_types: vec!["openai:*".into()],
        protocol_map_rules: vec![
            pm(
                "Module creates, updates, or sends to external service",
                "manual_review",
                "Module performs external side-effects",
            ),
            pm(
                "Module reads, searches, or transforms data",
                "agent_memory",
                "Module processes or extracts reusable data",
            ),
            pm(
                "Webhook output, trigger another scenario",
                "emit_event",
                "Module triggers downstream scenarios",
            ),
            pm(
                "Email, Slack, notification modules",
                "user_message",
                "Module sends notifications",
            ),
        ],
        is_builtin: true,
    }
}

/// Get all built-in platform definitions (cached after first call).
pub fn builtin_definitions() -> &'static [PlatformDefinition] {
    &BUILTIN_DEFS
}

/// Look up a platform definition by ID from the builtins (cached).
pub fn get_builtin(platform_id: &str) -> Option<&'static PlatformDefinition> {
    BUILTIN_DEFS.iter().find(|d| d.id == platform_id)
}

// ============================================================================
// Helper constructors
// ============================================================================

fn nt(source: &str, target: &str) -> personas_db::models::NodeTypeMapping {
    personas_db::models::NodeTypeMapping {
        source_pattern: source.into(),
        target_service: target.into(),
    }
}

fn cc(
    sources: &[&str],
    target: &str,
    desc: &str,
) -> personas_db::models::CredentialConsolidationRule {
    personas_db::models::CredentialConsolidationRule {
        source_patterns: sources.iter().map(|s| s.to_string()).collect(),
        target_connector: target.into(),
        description: desc.into(),
    }
}

fn nr(pattern: &str, role: &str) -> personas_db::models::NodeRolePattern {
    personas_db::models::NodeRolePattern {
        pattern: pattern.into(),
        role: role.into(),
    }
}

fn pm(pattern: &str, protocol: &str, condition: &str) -> personas_db::models::ProtocolMapRule {
    personas_db::models::ProtocolMapRule {
        platform_pattern: pattern.into(),
        target_protocol: protocol.into(),
        condition: condition.into(),
    }
}
