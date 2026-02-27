#[macro_use]
pub mod macros;
#[allow(dead_code)] // Functions used by Tauri commands in Phase 3
pub mod migrations;
#[allow(dead_code)]
pub mod models;
#[allow(dead_code)]
pub mod repos;
pub mod settings_keys;

use r2d2::{CustomizeConnection, Pool};
use r2d2_sqlite::SqliteConnectionManager;
use rusqlite::params;
use std::path::PathBuf;

use crate::error::AppError;

pub type DbPool = Pool<SqliteConnectionManager>;

/// Connection customizer that sets per-connection SQLite pragmas.
#[derive(Debug)]
struct SqlitePragmaCustomizer;

impl CustomizeConnection<rusqlite::Connection, rusqlite::Error> for SqlitePragmaCustomizer {
    fn on_acquire(&self, conn: &mut rusqlite::Connection) -> Result<(), rusqlite::Error> {
        conn.execute_batch(
            "PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -8000;",
        )?;
        Ok(())
    }
}

/// Initialize the database: create file, enable WAL + foreign keys, run migrations, seed data.
pub fn init_db(app_data_dir: &PathBuf) -> Result<DbPool, AppError> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("personas.db");

    tracing::info!(path = %db_path.display(), "Initializing database");

    let manager = SqliteConnectionManager::file(&db_path);
    let pool = Pool::builder()
        .max_size(8)
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    // Set WAL journal mode (database-wide, only needs to run once)
    {
        let conn = pool.get()?;
        conn.execute_batch("PRAGMA journal_mode = WAL;")?;
        tracing::debug!("SQLite pragmas configured (WAL, FK, busy_timeout)");
    }

    // Run migrations
    {
        let conn = pool.get()?;
        migrations::run(&conn)?;
        migrations::run_incremental(&conn)?;
    }

    // Seed builtin data
    {
        let conn = pool.get()?;
        seed_builtin_tools(&conn)?;
        seed_builtin_connectors(&conn)?;
    }

    tracing::info!("Database initialized successfully");
    Ok(pool)
}

/// Seed the 7 builtin tool definitions.
fn seed_builtin_tools(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();
    let tools = [
        ("builtin-http-request", "http_request", "network", "Make HTTP requests to external APIs", "builtin://http_request", None),
        ("builtin-gmail-read", "gmail_read", "email", "Read emails from Gmail", "builtin://gmail_read", Some("gmail")),
        ("builtin-gmail-send", "gmail_send", "email", "Send emails via Gmail", "builtin://gmail_send", Some("gmail")),
        ("builtin-gmail-search", "gmail_search", "email", "Search Gmail messages", "builtin://gmail_search", Some("gmail")),
        ("builtin-gmail-mark-read", "gmail_mark_read", "email", "Mark Gmail messages as read", "builtin://gmail_mark_read", Some("gmail")),
        ("builtin-file-read", "file_read", "filesystem", "Read file contents from disk", "builtin://file_read", None),
        ("builtin-file-write", "file_write", "filesystem", "Write content to files on disk", "builtin://file_write", None),
    ];

    for (id, name, category, description, script_path, cred_type) in &tools {
        conn.execute(
            "INSERT OR IGNORE INTO persona_tool_definitions
             (id, name, category, description, script_path, requires_credential_type, is_builtin, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, ?7, ?7)",
            params![id, name, category, description, script_path, cred_type, now],
        )?;
    }

    tracing::debug!("Builtin tool definitions seeded");
    Ok(())
}

/// Seed built-in connector templates that should be available to all users.
fn seed_builtin_connectors(conn: &rusqlite::Connection) -> Result<(), AppError> {
    let now = chrono::Utc::now().to_rfc3339();

    struct BuiltinConnector {
        id: &'static str,
        name: &'static str,
        label: &'static str,
        color: &'static str,
        icon_url: &'static str,
        category: &'static str,
        fields: &'static str,
        healthcheck_config: Option<&'static str>,
        metadata: Option<&'static str>,
    }

    let connectors: &[BuiltinConnector] = &[
        BuiltinConnector {
            id: "builtin-google-workspace-oauth-template",
            name: "google_workspace_oauth_template",
            label: "Google Workspace",
            color: "#4285F4",
            icon_url: "/icons/connectors/google.svg",
            category: "productivity",
            fields: "[]",
            healthcheck_config: Some(r#"{"endpoint":"https://www.googleapis.com/oauth2/v1/userinfo?alt=json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates Google OAuth identity access"}"#),
            metadata: Some(r#"{"template_enabled":true,"recommended":true,"summary":"Google Workspace consent-first template for Gmail, Drive, and Calendar automation.","setup_instructions":"1. Open Google Cloud Console (https://console.cloud.google.com).\n2. Create/select a project and enable Gmail API, Google Drive API, and Google Calendar API.\n3. Configure OAuth consent screen and add authorized test users.\n4. In Personas, click Authorize with Google.\n5. Complete consent in your browser.\n6. Return to Personas; token metadata is saved automatically.","oauth_type":"google","auth_type":"oauth","auth_type_label":"OAuth","docs_url":"https://console.cloud.google.com/apis/credentials","auth_methods":[{"id":"oauth","label":"OAuth","type":"oauth","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-google-workspace","transport":"stdio","suggested_env":{"GOOGLE_CLIENT_ID":"","GOOGLE_CLIENT_SECRET":"","GOOGLE_REFRESH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-airtable",
            name: "airtable",
            label: "Airtable",
            color: "#18BFFF",
            icon_url: "/icons/connectors/airtable.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"Personal Access Token","type":"password","required":true,"placeholder":"pat...","helpText":"Generate at airtable.com/create/tokens"},{"key":"base_id","label":"Base ID","type":"text","required":false,"placeholder":"appXXXXXXXXXXXXXX","helpText":"Optional: restrict to a specific base"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.airtable.com/v0/meta/whoami","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via whoami endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Airtable spreadsheet-database for project tracking and data management.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://airtable.com/create/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-notion",
            name: "notion",
            label: "Notion",
            color: "#000000",
            icon_url: "/icons/connectors/notion.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"Integration Token","type":"password","required":true,"placeholder":"ntn_...","helpText":"Create an internal integration at notion.so/my-integrations"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.notion.com/v1/users/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}","Notion-Version":"2022-06-28"},"description":"Validates integration token via users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Notion workspace for knowledge bases, wikis, and project management.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://www.notion.so/my-integrations","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@notionhq/mcp-server","transport":"stdio","suggested_env":{"NOTION_TOKEN":"","OPENAI_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-clickup",
            name: "clickup",
            label: "ClickUp",
            color: "#7B68EE",
            icon_url: "/icons/connectors/clickup.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"pk_...","helpText":"From ClickUp Settings → Apps → API Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.clickup.com/api/v2/user","method":"GET","headers":{"Authorization":"{{api_key}}"},"description":"Validates API key via user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"ClickUp project management with tasks, docs, goals, and time tracking.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://clickup.com/api/developer-portal/authentication","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-github",
            name: "github",
            label: "GitHub",
            color: "#1F2937",
            icon_url: "/icons/connectors/github.svg",
            category: "development",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"ghp_...","helpText":"Generate at github.com/settings/tokens with required scopes"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.github.com/user","method":"GET","headers":{"Authorization":"Bearer {{personal_access_token}}","Accept":"application/vnd.github+json","User-Agent":"personas-desktop"},"description":"Validates PAT via GitHub user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"GitHub for repositories, issues, pull requests, and CI/CD.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://github.com/settings/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-github","transport":"stdio","suggested_env":{"GITHUB_PERSONAL_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-calendly",
            name: "calendly",
            label: "Calendly",
            color: "#006BFF",
            icon_url: "/icons/connectors/calendly.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key","label":"Personal Access Token","type":"password","required":true,"placeholder":"eyJ...","helpText":"Generate at calendly.com/integrations/api_webhooks"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.calendly.com/users/me","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates token via Calendly users/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Calendly scheduling for meetings and appointment automation.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developer.calendly.com/api-docs/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-supabase",
            name: "supabase",
            label: "Supabase",
            color: "#3ECF8E",
            icon_url: "/icons/connectors/supabase.svg",
            category: "database",
            fields: r#"[{"key":"project_url","label":"Project URL","type":"url","required":true,"placeholder":"https://xxxx.supabase.co","helpText":"From Supabase Dashboard → Settings → API"},{"key":"anon_key","label":"Anon / Public Key","type":"password","required":true,"placeholder":"eyJ...","helpText":"The anon key for client-side access"},{"key":"service_role_key","label":"Service Role Key","type":"password","required":false,"placeholder":"eyJ...","helpText":"Optional: for server-side admin access (bypasses RLS)"},{"key":"pooler_url","label":"Pooler Connection String","type":"password","required":false,"placeholder":"postgresql://postgres.xxxx:...","helpText":"Optional: Supavisor pooler URL for direct database access"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{project_url}}/rest/v1/","method":"GET","headers":{"apikey":"{{anon_key}}","Authorization":"Bearer {{anon_key}}"},"description":"Validates Supabase connection via REST endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Supabase open-source Firebase alternative with Postgres, auth, and realtime.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://supabase.com/dashboard/project/_/settings/api","auth_variants":[{"id":"anon","label":"Anon Key","fields":["project_url","anon_key"],"auth_type_label":"API Key"},{"id":"service_role","label":"Service Role","fields":["project_url","anon_key","service_role_key"],"auth_type_label":"Service Role"},{"id":"pooler","label":"Pooler URL","fields":["project_url","anon_key","pooler_url"],"auth_type_label":"Connection String"}],"auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@supabase/mcp-server-supabase","transport":"stdio","suggested_env":{"SUPABASE_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-sentry",
            name: "sentry",
            label: "Sentry",
            color: "#362D59",
            icon_url: "/icons/connectors/sentry.svg",
            category: "monitoring",
            fields: r#"[{"key":"auth_token","label":"Auth Token","type":"password","required":true,"placeholder":"sntrys_...","helpText":"Generate at sentry.io/settings/auth-tokens/"},{"key":"organization_slug","label":"Organization Slug","type":"text","required":true,"placeholder":"my-org","helpText":"Your Sentry organization slug from the URL"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://sentry.io/api/0/organizations/{{organization_slug}}/","method":"GET","headers":{"Authorization":"Bearer {{auth_token}}"},"description":"Validates auth token via organization endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Sentry application monitoring for errors, performance, and session replay.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://docs.sentry.io/api/guides/create-auth-token/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@sentry/mcp-server-sentry","transport":"stdio","suggested_env":{"SENTRY_AUTH_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-betterstack",
            name: "betterstack",
            label: "Better Stack",
            color: "#E5484D",
            icon_url: "/icons/connectors/betterstack.svg",
            category: "monitoring",
            fields: r#"[{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From Better Stack Dashboard → Settings → API tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://uptime.betterstack.com/api/v2/monitors","method":"GET","headers":{"Authorization":"Bearer {{api_token}}"},"description":"Validates API token via monitors endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Better Stack uptime monitoring, incident management, and status pages.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://betterstack.com/docs/uptime/api/getting-started-with-uptime-api/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-mixpanel",
            name: "mixpanel",
            label: "Mixpanel",
            color: "#7856FF",
            icon_url: "/icons/connectors/mixpanel.svg",
            category: "analytics",
            fields: r#"[{"key":"service_account_username","label":"Service Account Username","type":"text","required":true,"placeholder":"","helpText":"From Mixpanel → Organization Settings → Service Accounts"},{"key":"service_account_secret","label":"Service Account Secret","type":"password","required":true,"placeholder":"","helpText":"The secret paired with the service account username"},{"key":"project_id","label":"Project ID","type":"text","required":true,"placeholder":"","helpText":"From Mixpanel → Project Settings → Project ID"},{"key":"project_token","label":"Project Token","type":"password","required":false,"placeholder":"","helpText":"From Mixpanel → Project Settings → Access Keys → Project Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://mixpanel.com/api/app/me","method":"GET","headers":{"Authorization":"Basic {{base64(service_account_username:service_account_secret)}}"},"description":"Validates service account via Mixpanel app/me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Mixpanel product analytics with GDPR-compliant data access.","auth_type":"project_secret","auth_type_label":"Service Account","docs_url":"https://developer.mixpanel.com/reference/project-secret","auth_variants":[{"id":"service_account","label":"Service Account","fields":["service_account_username","service_account_secret","project_id"],"auth_type_label":"Service Account"},{"id":"project_token","label":"Project Token","fields":["project_id","project_token"],"auth_type_label":"Project Token"}],"auth_methods":[{"id":"project_secret","label":"Service Account","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-twilio-segment",
            name: "twilio_segment",
            label: "Twilio Segment",
            color: "#52BD94",
            icon_url: "/icons/connectors/twilio.svg",
            category: "analytics",
            fields: r#"[{"key":"write_key","label":"Write Key","type":"password","required":true,"placeholder":"","helpText":"From Segment → Sources → your source → Settings → API Keys"},{"key":"access_token","label":"Access Token","type":"password","required":false,"placeholder":"","helpText":"Optional: for Config API access (workspace-level)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.segment.io/v1/batch","method":"POST","headers":{"Authorization":"Basic {{base64(write_key:)}}","Content-Type":"application/json"},"description":"Validates write key via Segment batch endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Twilio Segment customer data platform for event tracking and routing.","auth_type":"write_key","auth_type_label":"Write Key","docs_url":"https://segment.com/docs/connections/sources/catalog/","auth_variants":[{"id":"write","label":"Write Key","fields":["write_key"],"auth_type_label":"Write Key"},{"id":"config","label":"Write + Config API","fields":["write_key","access_token"],"auth_type_label":"Config API"}],"auth_methods":[{"id":"write_key","label":"Write Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-monday",
            name: "monday",
            label: "Monday.com",
            color: "#FF3D57",
            icon_url: "/icons/connectors/monday.svg",
            category: "productivity",
            fields: r#"[{"key":"api_key_v2","label":"API v2 Token","type":"password","required":true,"placeholder":"eyJ...","helpText":"From monday.com → Avatar → Developers → My Access Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.monday.com/v2","method":"POST","headers":{"Authorization":"{{api_key_v2}}","Content-Type":"application/json"},"body":"{\"query\":\"{ me { id } }\"}","description":"Validates API token via Monday GraphQL endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Monday.com work management platform for projects, workflows, and CRM.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developer.monday.com/api-reference/docs/authentication","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-linear",
            name: "linear",
            label: "Linear",
            color: "#5E6AD2",
            icon_url: "/icons/connectors/linear.svg",
            category: "development",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"lin_api_...","helpText":"From Linear → Settings → API → Personal API keys"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.linear.app/graphql","method":"POST","headers":{"Authorization":"{{api_key}}","Content-Type":"application/json"},"body":"{\"query\":\"{ viewer { id } }\"}","description":"Validates API key via Linear GraphQL viewer query"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Linear issue tracking for software teams with cycles, projects, and triage.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://linear.app/settings/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"mcp-linear","transport":"stdio","suggested_env":{"LINEAR_API_KEY":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-posthog",
            name: "posthog",
            label: "PostHog",
            color: "#F9BD2B",
            icon_url: "/icons/connectors/posthog.svg",
            category: "analytics",
            fields: r#"[{"key":"personal_api_key","label":"Personal API Key","type":"password","required":true,"placeholder":"phx_...","helpText":"From PostHog → Settings → Personal API Keys"},{"key":"project_api_key","label":"Project API Key","type":"password","required":false,"placeholder":"phc_...","helpText":"Optional: project token for event ingestion"},{"key":"host","label":"Host","type":"url","required":false,"placeholder":"https://us.posthog.com","helpText":"Defaults to us.posthog.com. Use eu.posthog.com for EU cloud."}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{host|https://us.posthog.com}}/api/projects/","method":"GET","headers":{"Authorization":"Bearer {{personal_api_key}}"},"description":"Validates personal API key via projects endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"PostHog product analytics, feature flags, session replay, and A/B testing.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://posthog.com/docs/api","auth_variants":[{"id":"personal","label":"Personal API Key","fields":["personal_api_key","host"],"auth_type_label":"API Key"},{"id":"project","label":"Project Key","fields":["project_api_key","host"],"auth_type_label":"Project Key"}],"auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-circleci",
            name: "circleci",
            label: "CircleCI",
            color: "#343434",
            icon_url: "/icons/connectors/circleci.svg",
            category: "development",
            fields: r#"[{"key":"personal_token","label":"Personal API Token","type":"password","required":true,"placeholder":"CCIPAT_...","helpText":"From CircleCI → User Settings → Personal API Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://circleci.com/api/v2/me","method":"GET","headers":{"Circle-Token":"{{personal_token}}"},"description":"Validates token via CircleCI me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"CircleCI continuous integration and delivery platform.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://circleci.com/docs/managing-api-tokens/","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-convex",
            name: "convex",
            label: "Convex",
            color: "#F97316",
            icon_url: "/icons/connectors/convex.svg",
            category: "database",
            fields: r#"[{"key":"deployment_url","label":"Deployment URL","type":"url","required":true,"placeholder":"https://your-app-123.convex.cloud","helpText":"From Convex Dashboard → Settings → URL"},{"key":"deploy_key","label":"Deploy Key","type":"password","required":true,"placeholder":"prod:...","helpText":"From Convex Dashboard → Settings → Deploy Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{deployment_url}}/version","method":"GET","headers":{},"description":"Validates Convex deployment URL is reachable"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Convex real-time backend-as-a-service with database, functions, and scheduling.","auth_type":"deploy_key","auth_type_label":"Deploy Key","docs_url":"https://docs.convex.dev/production/hosting/deploy-keys","auth_methods":[{"id":"deploy_key","label":"Deploy Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-buffer",
            name: "buffer",
            label: "Buffer",
            color: "#168EEA",
            icon_url: "/icons/connectors/buffer.svg",
            category: "social",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"From Buffer → Settings → Apps → Access Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.bufferapp.com/1/user.json","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Buffer user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Buffer social media management for scheduling and publishing.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://buffer.com/developers/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        // ── New connectors ──
        BuiltinConnector {
            id: "builtin-slack",
            name: "slack",
            label: "Slack",
            color: "#4A154B",
            icon_url: "/icons/connectors/slack.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot User OAuth Token","type":"password","required":true,"placeholder":"xoxb-...","helpText":"From Slack App → OAuth & Permissions → Bot User OAuth Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://slack.com/api/auth.test","method":"GET","headers":{"Authorization":"Bearer {{bot_token}}"},"description":"Validates bot token via Slack auth.test endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Slack workspace messaging for channels, DMs, and workflow notifications.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://api.slack.com/authentication/token-types","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-slack","transport":"stdio","suggested_env":{"SLACK_BOT_TOKEN":"","SLACK_TEAM_ID":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-discord",
            name: "discord",
            label: "Discord",
            color: "#5865F2",
            icon_url: "/icons/connectors/discord.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot Token","type":"password","required":true,"placeholder":"","helpText":"From Discord Developer Portal → Bot → Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://discord.com/api/v10/users/@me","method":"GET","headers":{"Authorization":"Bot {{bot_token}}"},"description":"Validates bot token via Discord users/@me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Discord bot integration for server messaging, moderation, and notifications.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://discord.com/developers/applications","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-telegram",
            name: "telegram",
            label: "Telegram",
            color: "#26A5E4",
            icon_url: "/icons/connectors/telegram.svg",
            category: "messaging",
            fields: r#"[{"key":"bot_token","label":"Bot Token","type":"password","required":true,"placeholder":"123456:ABC-DEF...","helpText":"From @BotFather on Telegram → /newbot or /token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.telegram.org/bot{{bot_token}}/getMe","method":"GET","headers":{},"description":"Validates bot token via Telegram getMe endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Telegram bot for messaging, notifications, and group automation.","auth_type":"bot_token","auth_type_label":"Bot Token","docs_url":"https://core.telegram.org/bots/api","auth_methods":[{"id":"bot_token","label":"Bot Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-sendgrid",
            name: "sendgrid",
            label: "SendGrid",
            color: "#1A82E2",
            icon_url: "/icons/connectors/sendgrid.svg",
            category: "messaging",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"SG....","helpText":"From SendGrid → Settings → API Keys → Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.sendgrid.com/v3/scopes","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via SendGrid scopes endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"SendGrid transactional and marketing email delivery at scale.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://docs.sendgrid.com/ui/account-and-settings/api-keys","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-resend",
            name: "resend",
            label: "Resend",
            color: "#000000",
            icon_url: "/icons/connectors/resend.svg",
            category: "messaging",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"re_...","helpText":"From Resend Dashboard → API Keys → Create API Key"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.resend.com/domains","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Resend domains endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Resend modern email API for developers with React Email support.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://resend.com/docs/api-reference/introduction","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-vercel",
            name: "vercel",
            label: "Vercel",
            color: "#000000",
            icon_url: "/icons/connectors/vercel.svg",
            category: "devops",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"","helpText":"From Vercel → Settings → Tokens → Create"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.vercel.com/v2/user","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Vercel user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Vercel frontend deployment platform with serverless functions and edge network.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://vercel.com/account/tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-netlify",
            name: "netlify",
            label: "Netlify",
            color: "#00C7B7",
            icon_url: "/icons/connectors/netlify.svg",
            category: "devops",
            fields: r#"[{"key":"access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"","helpText":"From Netlify → User Settings → Applications → Personal Access Tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.netlify.com/api/v1/user","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Netlify user endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Netlify web deployment platform with serverless functions and form handling.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://app.netlify.com/user/applications#personal-access-tokens","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-cloudflare",
            name: "cloudflare",
            label: "Cloudflare",
            color: "#F38020",
            icon_url: "/icons/connectors/cloudflare.svg",
            category: "devops",
            fields: r#"[{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From Cloudflare Dashboard → My Profile → API Tokens → Create Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.cloudflare.com/client/v4/user/tokens/verify","method":"GET","headers":{"Authorization":"Bearer {{api_token}}"},"description":"Validates API token via Cloudflare token verify endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Cloudflare CDN, DNS, Workers, and security services.","auth_type":"api_token","auth_type_label":"API Token","docs_url":"https://dash.cloudflare.com/profile/api-tokens","auth_methods":[{"id":"api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@cloudflare/mcp-server-cloudflare","transport":"stdio","suggested_env":{"CLOUDFLARE_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-figma",
            name: "figma",
            label: "Figma",
            color: "#F24E1E",
            icon_url: "/icons/connectors/figma.svg",
            category: "creativity",
            fields: r#"[{"key":"personal_access_token","label":"Personal Access Token","type":"password","required":true,"placeholder":"figd_...","helpText":"From Figma → Settings → Personal Access Tokens → Generate"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.figma.com/v1/me","method":"GET","headers":{"X-Figma-Token":"{{personal_access_token}}"},"description":"Validates personal access token via Figma me endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Figma collaborative design tool for UI/UX, prototyping, and design systems.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://www.figma.com/developers/api","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-figma","transport":"stdio","suggested_env":{"FIGMA_PERSONAL_ACCESS_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-hubspot",
            name: "hubspot",
            label: "HubSpot",
            color: "#FF7A59",
            icon_url: "/icons/connectors/hubspot.svg",
            category: "crm",
            fields: r#"[{"key":"access_token","label":"Private App Access Token","type":"password","required":true,"placeholder":"pat-...","helpText":"From HubSpot → Settings → Integrations → Private Apps → Create"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.hubapi.com/crm/v3/objects/contacts?limit=1","method":"GET","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via HubSpot contacts endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"HubSpot CRM for contacts, deals, marketing automation, and sales pipelines.","auth_type":"pat","auth_type_label":"PAT","docs_url":"https://developers.hubspot.com/docs/api/private-apps","auth_methods":[{"id":"pat","label":"PAT","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-jira",
            name: "jira",
            label: "Jira",
            color: "#0052CC",
            icon_url: "/icons/connectors/jira.svg",
            category: "development",
            fields: r#"[{"key":"domain","label":"Atlassian Domain","type":"text","required":true,"placeholder":"your-company.atlassian.net","helpText":"Your Jira Cloud domain (without https://)"},{"key":"email","label":"Account Email","type":"text","required":true,"placeholder":"you@company.com","helpText":"The email address for your Atlassian account"},{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From id.atlassian.com/manage-profile/security/api-tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://{{domain}}/rest/api/3/myself","method":"GET","headers":{"Authorization":"Basic {{base64(email:api_token)}}","Accept":"application/json"},"description":"Validates credentials via Jira myself endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Jira issue tracking and project management for agile software teams.","auth_type":"basic_api_token","auth_type_label":"API Token","docs_url":"https://id.atlassian.com/manage-profile/security/api-tokens","auth_methods":[{"id":"basic_api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-atlassian","transport":"stdio","suggested_env":{"JIRA_URL":"","JIRA_USERNAME":"","JIRA_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-confluence",
            name: "confluence",
            label: "Confluence",
            color: "#172B4D",
            icon_url: "/icons/connectors/confluence.svg",
            category: "development",
            fields: r#"[{"key":"domain","label":"Atlassian Domain","type":"text","required":true,"placeholder":"your-company.atlassian.net","helpText":"Your Confluence Cloud domain (without https://)"},{"key":"email","label":"Account Email","type":"text","required":true,"placeholder":"you@company.com","helpText":"The email address for your Atlassian account"},{"key":"api_token","label":"API Token","type":"password","required":true,"placeholder":"","helpText":"From id.atlassian.com/manage-profile/security/api-tokens"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://{{domain}}/wiki/rest/api/space?limit=1","method":"GET","headers":{"Authorization":"Basic {{base64(email:api_token)}}","Accept":"application/json"},"description":"Validates credentials via Confluence spaces endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Confluence wiki and knowledge base for team documentation and collaboration.","auth_type":"basic_api_token","auth_type_label":"API Token","docs_url":"https://id.atlassian.com/manage-profile/security/api-tokens","auth_methods":[{"id":"basic_api_token","label":"API Token","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@anthropic/mcp-atlassian","transport":"stdio","suggested_env":{"CONFLUENCE_URL":"","CONFLUENCE_USERNAME":"","CONFLUENCE_API_TOKEN":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-neon",
            name: "neon",
            label: "Neon",
            color: "#00E699",
            icon_url: "/icons/connectors/neon.svg",
            category: "database",
            fields: r#"[{"key":"api_key","label":"API Key","type":"password","required":true,"placeholder":"","helpText":"From Neon Console → Account Settings → API Keys → Generate"},{"key":"connection_string","label":"Connection String","type":"password","required":false,"placeholder":"postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname","helpText":"Optional: PostgreSQL connection string for direct database access"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://console.neon.tech/api/v2/projects","method":"GET","headers":{"Authorization":"Bearer {{api_key}}"},"description":"Validates API key via Neon projects endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Neon serverless Postgres with branching, autoscaling, and bottomless storage.","auth_type":"api_key","auth_type_label":"API Key","docs_url":"https://neon.tech/docs/manage/api-keys","auth_methods":[{"id":"api_key","label":"API Key","type":"credential","is_default":true},{"id":"mcp","label":"MCP","type":"mcp","package":"@modelcontextprotocol/server-postgres","transport":"stdio","suggested_env":{"DATABASE_URL":""}}]}"#),
        },
        BuiltinConnector {
            id: "builtin-upstash",
            name: "upstash",
            label: "Upstash",
            color: "#00E9A3",
            icon_url: "/icons/connectors/upstash.svg",
            category: "database",
            fields: r#"[{"key":"redis_url","label":"REST URL","type":"url","required":true,"placeholder":"https://xxx.upstash.io","helpText":"From Upstash Console → Database → Details → REST API → URL"},{"key":"redis_token","label":"REST Token","type":"password","required":true,"placeholder":"","helpText":"From Upstash Console → Database → Details → REST API → Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"{{redis_url}}/ping","method":"GET","headers":{"Authorization":"Bearer {{redis_token}}"},"description":"Validates REST token via Upstash Redis PING command"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Upstash serverless Redis and Kafka for low-latency data at the edge.","auth_type":"api_token","auth_type_label":"REST Token","docs_url":"https://upstash.com/docs/redis/features/restapi","auth_methods":[{"id":"api_token","label":"REST Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-planetscale",
            name: "planetscale",
            label: "PlanetScale",
            color: "#000000",
            icon_url: "/icons/connectors/planetscale.svg",
            category: "database",
            fields: r#"[{"key":"service_token_id","label":"Service Token ID","type":"text","required":true,"placeholder":"","helpText":"From PlanetScale → Organization → Settings → Service Tokens"},{"key":"service_token","label":"Service Token","type":"password","required":true,"placeholder":"","helpText":"The service token secret paired with the token ID"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.planetscale.com/v1/organizations","method":"GET","headers":{"Authorization":"{{service_token_id}}:{{service_token}}"},"description":"Validates service token via PlanetScale organizations endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"PlanetScale serverless MySQL platform with branching and non-blocking schema changes.","auth_type":"service_token","auth_type_label":"Service Token","docs_url":"https://planetscale.com/docs/concepts/service-tokens","auth_methods":[{"id":"service_token","label":"Service Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-dropbox",
            name: "dropbox",
            label: "Dropbox",
            color: "#0061FF",
            icon_url: "/icons/connectors/dropbox.svg",
            category: "storage",
            fields: r#"[{"key":"access_token","label":"Access Token","type":"password","required":true,"placeholder":"sl.u...","helpText":"From Dropbox App Console → Generate Access Token (or use OAuth flow)"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.dropboxapi.com/2/users/get_current_account","method":"POST","headers":{"Authorization":"Bearer {{access_token}}"},"description":"Validates access token via Dropbox current account endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Dropbox cloud storage for file sync, sharing, and collaboration.","auth_type":"pat","auth_type_label":"Access Token","docs_url":"https://www.dropbox.com/developers/apps","auth_methods":[{"id":"pat","label":"Access Token","type":"credential","is_default":true}]}"#),
        },
        BuiltinConnector {
            id: "builtin-twilio-sms",
            name: "twilio_sms",
            label: "Twilio",
            color: "#F22F46",
            icon_url: "/icons/connectors/twilio.svg",
            category: "messaging",
            fields: r#"[{"key":"account_sid","label":"Account SID","type":"text","required":true,"placeholder":"AC...","helpText":"From Twilio Console → Account → Account SID"},{"key":"auth_token","label":"Auth Token","type":"password","required":true,"placeholder":"","helpText":"From Twilio Console → Account → Auth Token"}]"#,
            healthcheck_config: Some(r#"{"endpoint":"https://api.twilio.com/2010-04-01/Accounts/{{account_sid}}.json","method":"GET","headers":{"Authorization":"Basic {{base64(account_sid:auth_token)}}"},"description":"Validates credentials via Twilio account endpoint"}"#),
            metadata: Some(r#"{"template_enabled":true,"summary":"Twilio SMS, voice, WhatsApp, and communication APIs.","auth_type":"basic","auth_type_label":"Account SID","docs_url":"https://www.twilio.com/docs/usage/api","auth_methods":[{"id":"basic","label":"Account SID","type":"credential","is_default":true}]}"#),
        },
    ];

    for c in connectors {
        conn.execute(
            "INSERT OR IGNORE INTO connector_definitions
             (id, name, label, icon_url, color, category, fields,
              healthcheck_config, services, events, metadata, is_builtin,
              created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 1, ?12, ?12)",
            params![c.id, c.name, c.label, c.icon_url, c.color, c.category, c.fields,
                    c.healthcheck_config, "[]", "[]", c.metadata, now],
        )?;

        // Update existing rows to refresh fields/metadata on app upgrade
        conn.execute(
            "UPDATE connector_definitions
             SET label = ?1, icon_url = ?2, fields = ?3, healthcheck_config = ?4, metadata = ?5, updated_at = ?6
             WHERE name = ?7 AND is_builtin = 1",
            params![c.label, c.icon_url, c.fields, c.healthcheck_config, c.metadata, now, c.name],
        )?;
    }

    tracing::debug!("Seeded {} builtin connector definitions", connectors.len());
    Ok(())
}

#[cfg(test)]
pub fn init_test_db() -> Result<DbPool, AppError> {
    use std::time::Duration;

    // Use a unique temp file for each test to avoid in-memory connection issues with r2d2.
    let tmp = std::env::temp_dir().join(format!("personas_test_{}.db", uuid::Uuid::new_v4()));
    let manager = SqliteConnectionManager::file(&tmp);
    let pool = Pool::builder()
        .max_size(2)
        .connection_timeout(Duration::from_secs(5))
        .connection_customizer(Box::new(SqlitePragmaCustomizer))
        .build(manager)?;

    let conn = pool.get()?;
    migrations::run(&conn)?;
    migrations::run_incremental(&conn)?;
    seed_builtin_tools(&conn)?;
    seed_builtin_connectors(&conn)?;
    drop(conn);
    Ok(pool)
}
