/**
 * English translations -- source of truth for the Personas application.
 *
 * =======================================================================
 *  TRANSLATOR GUIDE
 * =======================================================================
 *
 * 1. Every key has a comment explaining WHERE and HOW the string is used.
 *    Read the comment before translating -- context matters.
 *
 * 2. Variables use {curly braces}: "You have {count} agents".
 *    Keep the variable names exactly as-is; only translate surrounding text.
 *
 * 3. Pluralization uses suffixes: _one, _few, _many, _other (+ _zero, _two for Arabic).
 *    Provide all forms required by the target language's plural rules.
 *
 * 4. Keep translations concise -- UI space is limited, especially in buttons,
 *    badges, and sidebar labels.
 *
 * 5. Do NOT translate:
 *    - Brand names: Claude, Personas, OAuth, GitLab, GitHub, Slack, Sentry, etc.
 *    - Technical identifiers: API, CLI, JSON, HTTPS, cron, webhook, URL, SQLite, AES-256
 *    - Proper nouns and product names: Anthropic, OpenAI, Gemini, Copilot, Ollama, LiteLLM
 *
 * 6. "Agent" and "Persona" are used interchangeably in the UI to mean
 *    an AI agent/bot the user has configured. Translate consistently.
 *
 * 7. "Credential" / "Key" = an API key, token, or password that lets an
 *    agent authenticate with an external service. "Vault" = the secure
 *    storage area for credentials.
 *
 * 8. "Connector" = an integration bridge between an agent and an external
 *    service (e.g. Slack connector, GitHub connector).
 *
 * 9. "Trigger" = an event or schedule that causes an agent to run
 *    (e.g. cron schedule, webhook, file change, clipboard change).
 *
 * 10. "Use case" / "Flow" = a specific task or workflow an agent performs,
 *     defined by a template. One agent can have multiple use cases.
 *
 * 11. "Template" = a pre-built agent blueprint from the catalog that users
 *     can adopt/customize. "Adoption" = the process of adopting a template.
 *
 * 12. "Execution" = a single run of an agent processing a task.
 *
 * 13. "Design Wizard" = the AI-guided agent creation flow.
 *
 * 14. "Blast radius" = the impact scope -- how many agents are affected
 *     if a credential is changed or removed.
 * =======================================================================
 */
export const en = {

  // -------------------------------------------------------------------
  //  COMMON -- shared across the entire UI
  // -------------------------------------------------------------------
  common: {
    // Progress indicators shown during async operations
    loading: "Loading...",
    saving: "Saving...",
    deleting: "Deleting...",
    creating: "Creating...",

    // Generic action buttons -- keep very short (1 word ideally)
    retry: "Retry",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    close: "Close",
    dismiss: "Dismiss",
    refresh: "Refresh",
    copy: "Copy",
    copied: "Copied",
    duplicate: "Duplicate",
    configure: "Configure",
    continue: "Continue",
    skip: "Skip",
    back: "Back",
    clear: "Clear",
    send: "Send",
    apply: "Apply",

    // Column/field headers used in tables and forms
    actions: "Actions",
    status: "Status",
    name: "Name",
    description: "Description",
    created: "Created",
    id: "ID",

    // Unified destructive-action confirmation dialog
    confirm_destructive_cannot_undo: "This action cannot be undone.",
    confirm_destructive_type_to_confirm: "Type {name} to confirm",
    confirm_destructive_discard: "Discard",
    confirm_destructive_delete_persona: "Delete Agent",
    confirm_destructive_delete_persona_warning: "This agent and all its configuration will be permanently removed.",
    confirm_destructive_discard_event: "Discard Event",
    confirm_destructive_discard_event_warning: "This dead-letter event will be permanently discarded.",

    // Generic feedback labels
    error: "Error",
    success: "Success",
    required: "required",

    // Default select dropdown placeholder (the dashes are decorative)
    select: "-- select --",
    no_results: "No results found",

    // Status labels used across multiple features
    active: "Active",
    inactive: "Inactive",
    enabled: "Enabled",
    disabled: "Disabled",
    // "Off" as a toggle state label (opposite of "Active")
    off: "Off",

    // Shown when user hovers a toggle to enable/disable something
    // {name} = the agent or item name
    enable_item: "Enable {name}",
    disable_item: "Disable {name}",

    // Pluralized item counters -- used in badges, summaries, tooltips
    // {count} = numeric count
    agent_count_one: "{count} agent",
    agent_count_other: "{count} agents",
    trigger_count_one: "{count} trigger",
    trigger_count_other: "{count} triggers",
    connector_count_one: "{count} connector",
    connector_count_other: "{count} connectors",
    tool_count_one: "{count} tool",
    tool_count_other: "{count} tools",
    channel_count_one: "{count} channel",
    channel_count_other: "{count} channels",
    event_count_one: "{count} event",
    event_count_other: "{count} events",
    use_case_count_one: "{count} use case",
    use_case_count_other: "{count} use cases",
    step_count_one: "{count} step",
    step_count_other: "{count} steps",
    scenario_count_one: "{count} scenario",
    scenario_count_other: "{count} scenarios",
    node_count_one: "{count} node",
    node_count_other: "{count} nodes",
    edge_count_one: "{count} edge",
    edge_count_other: "{count} edges",
    adoption_count_one: "{count} adoption",
    adoption_count_other: "{count} adoptions",

    // Shown next to an item count, e.g. "3 use cases selected"
    selected: "selected",

    // Generic "all" filter option
    all: "All",
    // Generic "none" label
    none: "None",
  },

  // -------------------------------------------------------------------
  //  CHROME -- window frame, footer bar, update banner, skip links
  // -------------------------------------------------------------------
  chrome: {
    // App title shown in title bar
    app_title: "Personas",
    // Accessibility: skip-to-content link
    skip_to_content: "Skip to content",
    // Title bar window controls (tooltips)
    minimize: "Minimize",
    restore: "Restore",
    maximize: "Maximize",
    close_window: "Close",
    // Update banner
    // {version} = the new version number
    update_available: "Update available: v{version}",
    install_and_restart: "Install & Restart",
    installing: "Installing...",
    // Footer bar
    expand_sidebar: "Expand sidebar",
    collapse_sidebar: "Collapse sidebar",
    network_settings: "Network settings",
    dark: "Dark",
    light: "Light",
    // Auth (footer + standalone)
    sign_in_google: "Sign in with Google",
    signed_in: "Signed in",
    sign_out: "Sign out",
    offline: "Offline",
  },

  // -------------------------------------------------------------------
  //  SIDEBAR -- main app navigation (left panel)
  // -------------------------------------------------------------------
  sidebar: {
    // Top-level nav items -- keep to 1--2 words max
    home: "Home",
    overview: "Overview",
    agents: "Agents",
    events: "Events",
    // "Keys" = credential/API key management section
    keys: "Connections",
    templates: "Templates",
    teams: "Teams",
    cloud: "Cloud",
    settings: "Settings",

    // Sub-nav items under "Home"
    welcome: "Welcome",
    system_check: "System Check",

    // Sub-nav items under "Overview"
    dashboard: "Dashboard",
    executions: "Activity",
    // "Manual Review" = human-in-the-loop approval queue
    manual_review: "Approvals",
    messages: "Messages",
    // "Knowledge" = the learned patterns knowledge graph
    knowledge: "Knowledge",
    // "SLA" = Service Level Agreement / reliability metrics
    sla: "Reliability",
    cron_agents: "Scheduled Agents",
    schedules: "Schedules",
    // "Health" = agent and system health overview
    health: "Health",

    // Sub-nav items under "Events" (event bus)
    live_stream: "Live Stream",
    // "Throttling" = rate limiting controls for event processing
    throttling: "Speed Limits",
    test: "Test",
    // "Local Relay" = Smee.io webhook forwarding for local development
    local_relay: "Local Relay",
    // "Cloud Events" = cloud-originated webhook events
    cloud_events: "Cloud Events",

    // Sub-nav items under "Home"
    roadmap: "Roadmap",

    // Sub-nav items under "Keys" (vault)
    credentials: "Credentials",
    databases: "Databases",
    catalog: "Catalog",
    // "Graph" = credential dependency graph visualization
    graph: "Dependencies",
    add_new: "Add new",

    // Top-level Plugins section
    plugins: "Plugins",

    // Sub-nav items under "Templates"
    n8n_import: "n8n Import",
    generated: "Generated",

    // Sub-nav items under "Cloud" (deployment)
    all_deployments: "All Deployments",
    cloud_execution: "Cloud Runs",
    gitlab: "GitLab",

    // Sub-nav items under "Settings"
    account: "Account",
    appearance: "Appearance",
    notifications: "Notifications",
    engine: "Engine",
    // "BYOM" = Bring Your Own Model
    byom: "Custom Models",
    data: "Data",
    admin: "Admin",

    // Agent sidebar sub-nav
    create: "Create",
    all_agents: "All Agents",
    favorites: "Favorites",
    recent: "Recent",

    // Plugin sidebar sub-nav
    browse: "Browse",
    dev_tools: "Dev Tools",
    active_project: "Active Project",
    // Dev tools sub-items
    projects: "Projects",
    context_map: "Context Map",
    idea_scanner: "Idea Scanner",
    idea_triage: "Idea Triage",
    task_runner: "Task Runner",
    skills: "Skills",

    // Settings sub-nav
    // "Network" = network proxy and connectivity settings
    network: "Network",

    // Tooltip shown on disabled nav items (feature not yet available)
    coming_soon: "Coming soon",
    // Tooltip shown when cloud features require sign-in
    sign_in_to_unlock: "Sign in to unlock cloud features",

    // Badge shown next to unreleased nav items
    soon_badge: "soon",

    // Screen-reader announcements for sidebar badges
    // {count} = number of items
    pending_reviews_sr: "{count} pending review",
    pending_reviews_sr_other: "{count} pending reviews",
    unread_messages_sr: "{count} unread message",
    unread_messages_sr_other: "{count} unread messages",
    pending_events_sr: "{count} pending event",
    pending_events_sr_other: "{count} pending events",
  },

  // -------------------------------------------------------------------
  //  HOME -- landing page after login
  //  (merged from src/features/home/i18n/en.ts)
  // -------------------------------------------------------------------
  home: {
    welcome: "Welcome",
    greeting_morning: "Good Morning",
    greeting_afternoon: "Good Afternoon",
    greeting_evening: "Good Evening",
    // "Operator" = the user's role/title on the home page header
    operator: "User",
    summary_empty: "Get started by creating your first agent or exploring the platform.",
    // {personasCount}, {personasPlural}, {credentialsCount}, {credentialsPlural} are injected
    summary_stats: "You have {personasCount} agent{personasPlural} and {credentialsCount} credential{credentialsPlural} configured.",
    quick_navigation: "Quick Navigation",
    // Shown in the footer area of the home page
    platform_label: "personas platform",
    // Roadmap section (fetched from cloud, displayed on home page)
    roadmap: {
      title: "Product Roadmap",
      subtitle: "What we're building now and what comes next.",
      unavailable: "Roadmap unavailable",
      unavailable_hint: "Could not load the product roadmap. Check your connection and try again.",
      // Status labels
      status_in_progress: "In Progress",
      status_next: "Next",
      status_planned: "Planned",
      status_completed: "Completed",
      // Priority labels
      priority_now: "Now",
      priority_next: "Next",
      priority_later: "Later",
      // Summary pills -- {count} = number of items in that status
      in_progress_count: "{count} In Progress",
      next_count: "{count} Next",
    },
    // First-use setup cards (role picker, tool picker, goal input)
    setup: {
      choose_role: "Choose your role",
      choose_role_hint: "We'll tailor the experience to match how you work.",
      pick_tool: "Pick your favorite tool",
      pick_tool_hint: "This will be your first service connection.",
      describe_goal: "What do you want to automate?",
      describe_goal_hint: "Describe your first automation goal — we'll help you set it up.",
      goal_placeholder: "e.g. Automatically sync new Jira tickets to a Slack channel...",
      ready_to_save: "Ready to save",
      // Setup card step labels
      step_role: "Your Role",
      step_role_hint: "Tell us your role so we can tailor the experience.",
      step_tool: "Favorite Tool",
      step_tool_hint: "Pick the first service you want to connect.",
      step_goal: "Automation Goal",
      step_goal_hint: "Describe what you would like to automate first.",
      // Gate messages
      select_role_first: "Select a role first to unlock tool options.",
      select_tool_first: "Select a tool first to set your goal.",
      // Navigation
      get_started: "Get Started",
      // Role definitions
      role_office_rat: "Office Rat",
      role_office_rat_hint: "Non-technical user",
      role_developer: "Developer",
      role_developer_hint: "Technical user",
      role_manager: "Manager",
      role_manager_hint: "Planning & coordination",
      // Progress labels
      role: "Role",
      tool: "Tool",
      goal: "Goal",
    },
    nav: {
      overview: {
        label: "Overview",
        description: "See how your agents are performing, what they've done recently, and monitor everything in one place",
      },
      personas: {
        label: "Agents",
        description: "Create, set up, and manage your AI agents -- give them custom behaviors and connect them to your tools",
      },
      events: {
        label: "Events",
        description: "Set up what triggers your agents to run -- schedules, incoming notifications, or changes you define",
      },
      credentials: {
        label: "Connections",
        description: "Manage your service logins, database connections, and passwords that let agents access your tools",
      },
      "design-reviews": {
        label: "Templates",
        description: "Browse ready-made agent blueprints, import workflows, and generate new agent designs",
      },
      team: {
        label: "Teams",
        description: "Combine multiple agents into a team that works together on multi-step workflows",
      },
      cloud: {
        label: "Cloud",
        description: "Run your agents in the cloud so they work even when your computer is off",
      },
      settings: {
        label: "Settings",
        description: "Your account, how the app looks, notification preferences, and advanced options",
      },
    },
  },

  // -------------------------------------------------------------------
  //  AGENTS -- agent listing, editor, creation wizard
  // -------------------------------------------------------------------
  agents: {
    title: "Personas",
    loading: "Loading...",

    // Agent overview page (grid of all agents)
    overview: {
      title: "My Agents",
      // {count} = total agent count
      subtitle_one: "{count} agent -- sorted by relevance",
      subtitle_other: "{count} agents -- sorted by relevance",
      // Filter group labels shown above the agent grid
      needs_attention: "Needs Attention",
      active: "Active",
      idle: "Idle",
    },

    // Sidebar agent list (left panel within agent section)
    sidebar: {
      no_match: "No agents match your filters",
      clear_filters: "Clear all filters",
      empty: "No personas yet",
    },

    // Hover preview card (shown when hovering over an agent in the sidebar)
    preview: {
      // Shown when sensitive persona details are hidden for privacy
      sensitive_hidden: "Sensitive Preview Hidden",
      sensitive_detail: "Details are masked for this persona.",
      // Keyboard modifier shown to reveal hidden details
      alt_key: "Alt",
      no_description: "No description yet.",
      last_execution: "Last Execution",
      no_executions: "No executions yet",
      // Stats row labels -- daily execution breakdown
      today: "Today",
      ok: "OK",
      fail: "Fail",
      // {count} triggers active on this agent
      triggers_active_one: "{count} trigger active",
      triggers_active_other: "{count} triggers active",
      no_triggers: "No triggers",
      // Fallback model name when provider is unknown
      custom_model: "Custom",
    },

    // Agent creation wizard
    creation: {
      heading: "New Agent",
      subtitle: "Set a name and identity for your agent.",
      name_placeholder: "Agent name",
      description_label: "Description",
      description_optional: "(optional)",
      description_placeholder: "Short description",
      customize_appearance: "Customize appearance",
      customize_optional: "(optional)",
      icon_label: "Icon",
      color_label: "Color",
      group_label: "Group",
      no_group: "No group",
      create_button: "Create Agent",
      creating_button: "Creating...",
      name_required: "Enter a name to continue",
    },

    // Agent editor -- tab bar labels
    editor: {
      tabs: {
        use_cases: "Use Cases",
        prompt: "Prompt",
        lab: "Lab",
        connectors: "Connectors",
        design: "Design",
        health: "Health",
        settings: "Settings",
        model: "Model",
      },
      no_persona: "No persona selected",
      // {tabs} = comma-separated list of tab names that failed to save
      save_failed: "Failed to save {tabs}",
      save_failed_generic: "Failed to save changes",

      // Banner shown when there are unsaved changes
      // {sections} = comma-separated list of changed section names
      unsaved_changes: "Unsaved changes: {sections}",
      unsaved_changes_generic: "Unsaved changes",
      save_and_switch: "Save & Switch",
      discard: "Discard",

      // Banner prompting user to try the AI Design Wizard
      design_wizard_banner: "Customize this template with the AI Design Wizard",
      try_design_wizard: "Try Design Wizard",

      // Cloud upsell banners
      cloud_banner_connect: "Connect to the cloud to run your agents remotely",
      cloud_banner_signin: "Sign in to unlock cloud features and remote execution",
      sign_in: "Sign In",
      set_up_cloud: "Set up Cloud",
    },

    // Agent header bar (top of the editor -- name, status toggle, warnings)
    header: {
      // Warning tooltips shown next to the status toggle
      no_triggers_warning: "No triggers set up -- this agent won't run automatically",
      // {credentials} = comma-separated list of missing credential names
      missing_credentials: "Missing credentials: {credentials}",
      toggle_failed: "Failed to toggle persona -- check your connection",
      cannot_enable: "Cannot enable persona",
    },

    // Screen-reader label for agent cards in the grid
    // {name}, {status}, {lastRun}, {triggerCount} are injected
    sr_card: "{name}, {status}",

    // Agent overview page -- filters and batch actions
    filters: {
      all: "All",
      all_agents: "All Agents",
      favorites: "Favorites",
      recent: "Recent",
      status_all: "All",
      status_active: "Active",
      status_disabled: "Disabled",
      status_drafts: "Drafts",
      health_all: "All Health",
      health_healthy: "Healthy",
      health_degraded: "Degraded",
      health_failing: "Failing",
      last_run: "Last Run",
      never: "Never",
      // {count} = number of selected agents
      selected: "{count} selected",
      remove_from_favorites: "Remove from favorites",
      add_to_favorites: "Add to favorites",
    },

    // Agent status labels (shown in overview grid and cards)
    status: {
      draft: "Draft",
      disabled: "Disabled",
      healthy: "Healthy",
      degraded: "Degraded",
      failing: "Failing",
      building: "Building",
    },
  },

  // -------------------------------------------------------------------
  //  VAULT -- credential management (Keys section)
  // -------------------------------------------------------------------
  vault: {
    title: "Vault",
    subtitle: "Choose how you want to add a credential",
    add_from_catalog: "Add from catalog",
    ai_designed: "AI-designed credential",
    workspace_connect: "Workspace Connect",
    quick_start: "Quick start",
    health: {
      // Badge labels for credential health status
      healthy: "healthy",
      needs_attention: "needs attention",
      untested: "untested",
    },
    list: {
      no_credentials: "No authenticated services detected. Select manually below.",
      delete_confirm: "Delete this credential?",
      // "Blast Radius" = impact analysis showing what breaks if this credential is removed
      blast_radius: "What's Affected",
      no_dependencies: "No agents depend on this credential. Safe to modify or remove.",
      affected_agents: "Affected Agents",
      affected_events: "Affected Events",
    },
    import: {
      title: "Import Source",
      picker_subtitle: "Choose the source of your secrets",
      select_all: "Select all",
      deselect_all: "None",
      // "Sync mode" = keep credentials in sync with the external source
      enable_sync: "Keep in sync automatically",
      source_ref: "Source reference",
      poll_interval: "How often to check",
      intervals: {
        min15: "15 min",
        min30: "30 min",
        hour1: "1 hour",
        hour6: "6 hours",
        day1: "24 hours",
      },
    },
    features: {
      // Alert shown when a credential starts failing unexpectedly
      anomaly_detected: "Unusual activity: this connection suddenly stopped working after it was fine before. The password or key may have been changed or revoked.",
      history: "History",
      event_triggers: "Event Triggers",
      rotation_policy: {
        rotate_every: "Rotate every",
        days: "days",
        no_policy: "No rotation policy configured.",
        // Active policy status labels
        oauth_refresh_active: "OAuth token refresh active",
        oauth_refresh_active_auto: "OAuth token refresh active (auto)",
        auto_rotation_active: "Auto-rotation active",
        rotation_paused: "Rotation paused",
        // Action buttons
        rotate_now: "Rotate Now",
        enable_rotation: "Enable Rotation",
        enabling: "Enabling...",
        remove_policy_tooltip: "Remove rotation policy",
        // Period editor
        save: "Save",
        cancel: "Cancel",
        // Rotation failed error prefix
        rotation_failed: "Rotation failed: {error}",
        remove_failed: "Failed to remove policy: {error}",
        update_failed: "Failed to update rotation period: {error}",
        enable_failed: "Failed to enable rotation: {error}",
        // Last rotation info -- {time} is relative (e.g. "2 hours ago")
        last_rotated: "Last rotated {time}",
      },
      // Anomaly scoring panel
      anomaly: {
        // Remediation level labels
        healthy: "Healthy",
        transient_issues: "Temporary Issues",
        degrading: "Getting Worse",
        permanent_errors: "Ongoing Errors",
        critical: "Critical",
        stale: "outdated",
        // {count} = number of healthcheck samples
        samples: "{count} checks",
        // Error classification labels
        permanent: "Ongoing: {rate}",
        transient: "Temporary: {rate}",
        tolerance: "Tolerance: {rate}",
      },
      // Rotation insight badge (compact header badge)
      rotation_badge: {
        disabled: "Disabled",
        perm_errors: "Ongoing Errors",
        degrading: "Getting Worse",
        backoff: "Waiting to Retry",
      },
      // Audit log table
      audit: {
        empty: "No audit entries yet. Operations will be logged as they occur.",
        // Operation labels
        op_decrypted: "Decrypted",
        op_created: "Created",
        op_updated: "Updated",
        op_deleted: "Deleted",
        op_healthcheck: "Connection Test",
        // Filter labels (includes "all" + operation types)
        filter_all: "all",
      },
      intelligence: {
        operation: "Operation",
        detail: "Detail",
        time: "Time",
      },
    },
    negotiator: {
      // "Negotiator" = the AI-guided credential provisioning wizard
      title: "AI Connection Setup",
      subtitle: "Automatically set up your service credentials",
      initializing: "Initializing negotiator...",
      prerequisites: "Prerequisites",
      all_steps_completed: "All steps completed",
      captured: "Credentials captured",
      error_title: "Something went wrong",
      // {label} = the connector/service name (e.g. "GitHub", "Slack")
      start_description: "Let the AI guide you step-by-step through setting up {label} access. It will open the right pages, tell you exactly what to click, and save your login details automatically.",
      start_button: "Start guided setup",
      // Estimated time -- {minutes} is a number
      estimated_time: "Takes ~{minutes} minutes",
      planning_description: "AI is looking at the service and creating a step-by-step setup guide...",
      // {label} = the connector/service name
      provisioning_label: "Setting up {label}",
      // {count} = number of captured credential fields
      fields_captured: "{count} field(s) auto-filled from the provisioning flow.",
      apply_button: "Apply to credential form",
      try_again: "Try again",
      // Guiding phase (step-by-step walkthrough)
      // {minutes} = estimated minutes remaining
      estimated_minutes: "~{minutes} min",
      // {completed}/{total} steps progress indicator
      steps_progress: "{completed}/{total} steps",
      // {count} = number of skipped steps
      steps_skipped: "{count} skipped",
      steps_auto_skipped_one: "{count} step auto-skipped",
      steps_auto_skipped_other: "{count} steps auto-skipped",
      tips_heading: "Tips & best practices",
      apply_credentials: "Apply credentials",
      // Individual step card
      open_in_browser: "Open in browser",
      step_complete_captured: "Step complete -- values captured",
      mark_complete: "Mark step complete",
      completed: "Completed",
    },
    // Credential card components (cards shown in the vault list)
    card: {
      // Scope mismatch banner
      scope_mismatch: "Scope mismatch",
      // {count} = number of missing scopes
      scope_missing_one: "{count} requested scope not granted: ",
      scope_missing_other: "{count} requested scopes not granted: ",
      reauthorize: "Reauthorize",
    },
    // Credential forms (auth method picker, healthcheck display, etc.)
    forms: {
      // Auth method tab labels
      auth_oauth: "OAuth",
      auth_api_key: "API Key",
      auth_mcp: "MCP",
      // Healthcheck result display
      healthcheck_passed: "Connection test passed",
      healthcheck_failed: "Connection test failed",
      healthcheck_running: "Testing connection...",
      technical_details: "Technical details",
      // Setup guide section
      // {label} = connector name (e.g. "GitHub", "Slack")
      how_to_get: "How to get",
      how_to_get_suffix: "credentials",
      // Template form header
      back_to_catalog: "Back to catalog",
      new_credential: "New Credential",
      configure_mcp: "Configure MCP server connection",
      configure_fields: "Configure credential fields",
      detect: "Detect",
      auto_add: "Auto Add",
    },
    // Credential type picker (shown in vault "Add Credential" flow)
    type_picker: {
      title: "Add Credential",
      subtitle: "Choose the type of connection",
      // Type options
      ai_built: "AI-Built Connector",
      ai_built_hint: "Describe what you want to connect to and AI creates the setup for you -- no configuration needed.",
      ai_built_use: "Use this for: Slack, GitHub, Notion, Linear, Jira",
      most_popular: "Most popular",
      mcp_server: "AI Tool Server",
      mcp_server_hint: "Connect to an AI tool server -- paste the address and you're done.",
      mcp_server_use: "Use this for: MCP-compatible tool servers and plugins",
      web_service: "Web Service",
      web_service_hint: "Connect to any web service -- we'll guide you through the login details step by step.",
      web_service_use: "Use this for: REST APIs, webhooks, or services not in the catalog",
      database: "Database",
      database_hint: "Connect to your database -- just paste the connection details and pick your tables.",
      database_use: "Use this for: PostgreSQL, MySQL, SQLite, MongoDB",
      desktop_app: "Desktop App",
      desktop_app_hint: "Link apps already on your computer like VS Code, Docker, or Obsidian in one click.",
      desktop_app_use: "Use this for: VS Code, Docker, Obsidian, local CLI tools",
      ai_wizard: "AI Setup Wizard",
      ai_wizard_hint: "Let AI find your services and set everything up automatically -- just follow along.",
      ai_wizard_recommended: "Recommended for beginners",
      ai_wizard_use: "Use this for: first-time setup or when you're not sure what to pick",
      ai_wizard_cta: "Not sure? Start here",
      workspace_connect: "Workspace Connect",
      workspace_connect_hint: "One Google login creates Gmail, Calendar, Drive, and Sheets credentials automatically",
      auto_discover: "Auto-Discover Credentials",
      auto_discover_hint: "Scan your filesystem for existing API keys, AWS profiles, env vars, and more",
    },
    // Credential card body (Google OAuth section)
    body: {
      // {name} = service name (e.g. "Google")
      authorizing: "Authorizing with {name}...",
      authorize_with: "Authorize with {name}",
      authorize_hint: "Opens {name} sign-in and saves your access after you approve.",
      // {time} = timestamp when consent was completed
      consent_completed: "{name} consent completed at {time}",
      update_failed: "Failed to update credential",
      delete_credential: "Delete credential",
    },
    // Credential list / connector cards
    connector: {
      // Category filter labels
      filter_all: "All",
      filter_connected: "Connected",
      filter_available: "Available",
    },
    // Auto-credential provisioning (browser automation)
    auto_cred: {
      // Consent step
      guided_setup: "Guided Setup",
      auto_setup: "Auto-Setup",
      guided_consent_body: "Claude will guide you step-by-step through creating credentials. URLs will open in your browser automatically.",
      auto_consent_body: "Claude designed the connection details. Now a browser window will open to create the actual credential on your behalf.",
      what_will_happen: "What will happen:",
      log_in_first: "Log in first.",
      // {label} = service name
      log_in_hint: "Make sure you are already registered and logged in to {label} in your browser before starting. This allows the automation to access your account settings directly.",
      your_consent: "Your consent is required.",
      guided_consent_hint: "Nothing is saved without your explicit approval. You will create the credential yourself following guided instructions.",
      auto_consent_hint: "Nothing is saved without your explicit approval. If a login page or CAPTCHA appears, the browser will pause for you to handle manually.",
      view_docs: "View credential docs",
      start_guided: "Start Guided Setup",
      start_browser: "Start Browser Session",
      // Browser error step
      browser_error_title: "Auto-Setup Failed",
      setup_manually: "Set Up Manually",
      retry: "Retry",
      // Error display
      what_happened: "What happened",
      // {seconds} = session duration
      session_duration: "Session ran for {seconds}s",
      // {count} = number of browser actions
      actions_performed_one: "{count} browser action performed",
      actions_performed_other: "{count} browser actions performed",
      last_url: "Last URL: {url}",
      captcha_encountered: "A login/CAPTCHA prompt was encountered",
      last_actions: "Last actions:",
      // {count} = number of log entries
      session_log: "Session log ({count} entries)",
      // Card step states
      step_confirmed: "Step confirmed -- waiting for detection",
      action_required: "Action Required",
      open_in_browser: "Open in Browser",
      completed_step: "I've completed this",
      input_requested: "Input Requested",
    },
    // Vector knowledge base
    vector: {
      documents_tab: "Documents",
      search_tab: "Search",
      settings_tab: "Settings",
      ingest_title: "Add Documents",
      ingest_hint: "Drop files here or click to browse",
      ingest_drop: "Drop files to add",
      ingest_supported: "Supported: txt, md, html, csv, json, yaml, code files",
      starting_ingestion: "Processing files...",
      no_valid_files: "No valid file paths found. Try dropping individual files.",
      no_documents: "No documents yet",
      no_documents_hint: "Drop files here, paste text, or scan a directory to start building your knowledge base.",
      refresh: "Refresh",
      paste_text: "Paste Text",
      directory: "Directory",
      delete_document: "Delete document",
      // {count} = number of documents
      document_count_one: "{count} document",
      document_count_other: "{count} documents",
      // Search result card
      show_full: "Show full excerpt",
      show_less: "Show less",
      copy_content: "Copy content",
      // Settings tab
      kb_info: "Knowledge Base Info",
      embedding_model: "Search Model",
      dimensions: "Dimensions",
      chunk_size: "Section Size",
      chunk_overlap: "Section Overlap",
      statistics: "Statistics",
      documents: "Documents",
      chunks: "Sections",
      local_embedding: "Local Search",
      // {model} = embedding model name, {dims} = dimension count
      local_embedding_hint: "Search indexing runs locally using {model} ({dims}-dim). No data leaves your machine. The model (~23MB) is downloaded on first use and saved locally.",
    },
    // Credential design modal (AI-guided credential creation)
    design_modal: {
      title: "Design Credential",
      error_title: "Something went wrong",
      // Error phase suggestions
      error_unexpected: "An unexpected error occurred.",
      error_parse_failed: "The AI could not generate a valid connector from your description.",
      error_timeout: "The request took too long and was stopped. This can happen with very broad requests.",
      error_cli_missing: "Claude CLI is not installed on this system.",
      error_env_conflict: "A conflicting environment variable is blocking the CLI. Restart the app to fix this automatically.",
      error_backend: "The AI backend returned an unexpected error.",
      technical_details: "Technical details",
      how_to_fix: "How to fix this",
      original_request: "Your original request (preserved):",
      start_over: "Start over",
      try_again_with: "Try again with your request",
    },
    // Desktop app cards
    desktop: {
      installed: "Installed",
      running: "Running",
      not_installed: "Not installed",
    },
    // Dependency graph
    graph: {
      no_dependencies: "No dependencies",
      // {count} = number of connections
      connection_count_one: "{count} connection",
      connection_count_other: "{count} connections",
      // {count} = number of dependents
      dep_count_one: "{count} dep",
      dep_count_other: "{count} deps",
      // Health labels
      not_tested: "Not tested",
      healthy: "Healthy",
      unhealthy: "Unhealthy",
    },
    // Wizard detect grid (auto-discovery)
    wizard: {
      // {count} = number of items in each section
      detected: "Detected ({count})",
      available: "Available ({count})",
      already_added: "Already added ({count})",
      // {search} = search query
      no_match: "No services match \"{search}\"",
      // Connector row labels
      already_added_badge: "Already added",
      local: "Local",
      cli_auth: "CLI auth",
      session: "Session",
    },
    playground: {
      // Credential playground modal -- tabs for exploring a credential
      tab_overview: "Overview",
      tab_api_explorer: "API Explorer",
      tab_recipes: "Recipes",
      tab_mcp_tools: "MCP Tools",
      tab_rotation: "Rotation",
      add_tag: "Add tag...",
      no_connector: "No connector definition available for this credential type.",
      // API Explorer
      try_button: "Try",
      parameters: "Parameters",
      request_body: "Request Body",
      path_placeholder: "/api/v1/resource",
      sending: "Sending...",
      // MCP Tools tab
      mcp_input_schema: "Input Schema",
      mcp_run: "Run",
      mcp_error: "Error",
      mcp_success: "Success",
      mcp_empty: "(empty)",
      mcp_discover: "Discover MCP server tools",
      mcp_discover_hint: "Connect to the MCP server to discover available tools and test them.",
      mcp_discover_button: "Discover Tools",
      // Response viewer
      response_empty: "(empty response)",
      header: "Header",
      value: "Value",
      path_parameters: "Path Parameters",
      query_parameters: "Query Parameters",
      headers: "Headers",
      body: "Body",
      empty_response: "(empty response)",
    },
  },

  // -------------------------------------------------------------------
  //  DEPLOYMENT -- cloud, GitLab, deployment dashboard
  // -------------------------------------------------------------------
  deployment: {
    title: "Deployment",
    orchestrator_url: "Cloud Server URL",
    api_key: "API Key",
    connecting: "Connecting...",
    sr_connecting: "Connecting to cloud server...",
    auth_code: "Authorization Code",
    deploying: "Deploying...",
    sr_deploying: "Deploying persona to cloud",
    no_targets: "No cloud services connected",
    status: {
      connected: "Connected",
      loading: "Loading cloud status...",
      token_available: "Token available",
      no_token: "No token configured",
      no_status: "No status data available.",
    },

    // Cloud panel tab labels
    tabs: {
      connection: "Connection",
      status: "Status",
      oauth: "OAuth",
      deployments: "Deployments",
      schedules: "Schedules",
      history: "History",
    },
    cloud_execution: "Cloud Execution",

    // Cloud status panel
    cloud_status: {
      workers: "Runners",
      // Worker states
      worker_idle: "Idle",
      worker_executing: "Running",
      worker_disconnected: "Disconnected",
      activity: "Activity",
      queue_length: "Waiting in Line",
      active_executions: "Currently Running",
      active_execution: "Currently Running",
      claude_token: "Claude Token",
    },

    // Cloud history panel
    history: {
      // Relative time labels (compact format for history list)
      just_now: "Just now",
      minutes_ago: "{minutes}m ago",
      hours_ago: "{hours}h ago",
      days_ago: "{days}d ago",
      // Summary stat card labels
      total_runs: "Total Runs",
      success_rate: "Success Rate",
      total_cost: "Total Cost",
      avg_duration: "Avg Duration",
      // Filter options
      all_personas: "All personas",
      all_statuses: "All statuses",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      // Time range filter options
      last_7_days: "Last 7 days",
      last_30_days: "Last 30 days",
      last_90_days: "Last 90 days",
      top_errors: "Top Errors",
    },

    // Cloud schedules panel
    schedules: {
      // {count} = number of cloud triggers
      header: "Cloud Triggers ({count})",
      add_trigger: "Add Trigger",
      deploy_first: "Deploy a persona first to create cloud triggers.",
      loading: "Loading triggers...",
      empty: "No cloud triggers yet. Create one to schedule automated runs.",
    },
  },

  // -------------------------------------------------------------------
  //  OVERVIEW -- dashboard, executions, messages, memories, schedules
  // -------------------------------------------------------------------
  overview: {
    title: "Overview",
    no_output: "No output yet",
    no_background_jobs: "No background jobs running or recent",
    // Subtitle explaining what appears in the background jobs panel
    background_jobs_hint: "Tasks appear here when you import workflows, set up templates, generate agents, or run diagnostics",

    filters: {
      start_date: "Start Date",
      end_date: "End Date",
      all_personas: "All Personas",
    },
    messages: {
      loading: "Loading messages...",
      no_messages: "No messages yet",
      switch_to_all: "Try switching to \"All\" to see all messages",
      columns: {
        persona: "Persona",
        title: "Title",
        priority: "Priority",
        status: "Status",
        created: "Created",
      },
      content_header: "Content",
      // Priority level labels (for message triage)
      priority_high: "High",
      priority_normal: "Normal",
      priority_low: "Low",
      // Filter tab labels
      filter_all: "All",
      filter_unread: "Unread",
      filter_high_priority: "High Priority",
      // Delivery status labels
      delivery_delivered: "Delivered",
      delivery_failed: "Failed",
      delivery_pending: "Pending",
      delivery_queued: "Queued",
      // Notification channel labels
      channel_email: "Email",
      channel_slack: "Slack",
      channel_telegram: "Telegram",
      channel_desktop: "Desktop",
    },
    realtime: {
      // {action} = a clickable action name (e.g. "Test Flow")
      idle: "Idle -- click {action} to simulate traffic",
      test_flow: "Test Flow",
      events_per_min: "events/min",
      pending: "pending",
      success: "success",
      in_window: "in window",
    },
    observability: {
      title: "Observability",
      subtitle: "Monitor execution health, costs, and anomalies across your agents",
      alert_rules: "Alert Rules",
      refresh_metrics: "Refresh metrics",
      persona_disabled: "Agent auto-paused",
      auto_resolved: "This issue was automatically resolved",
      mark_resolved: "Mark as Resolved",
      manual_fix: "(manual fix applied)",
      metrics_unavailable: "Metrics unavailable -- data shown may be stale",
      no_open_issues: "No open issues",
      run_analysis: "Run analysis to check for problems.",
    },
    memories: {
      title: "Memories",
      created_success: "Memory created successfully",
      no_memories: "No memories yet",
      form: {
        agent: "Agent",
        category: "Category",
        title: "Title",
        content: "Content",
        importance: "Importance",
        tags: "Tags",
        tags_hint: "(comma-separated)",
      },
    },
    executions: {
      title: "Executions",
      loading: "Loading executions...",
      no_agents: "No agents created yet",
      create_first: "Create your first agent to see execution activity here",
      no_executions: "No executions yet",
      run_agent: "Run an agent to see execution activity here",
    },

    // Workflows/background jobs panel
    workflows: {
      loading: "Loading workflows...",
    },

    // Schedule timeline panel
    schedules: {
      title: "Schedule Timeline",
      subtitle: "Aggregated view of all scheduled agent executions",
      // Scheduler engine controls
      engine_on: "Running",
      engine_off: "Stopped",
      engine_on_tooltip: "Schedules are active -- click to pause all",
      engine_off_tooltip: "Schedules are paused -- click to resume all",
      // {count} = number of active/paused schedules
      active_count: "{count} active",
      paused_count: "{count} paused",
      // View mode toggle labels
      view_grouped: "Grouped",
      view_timeline: "Timeline",
      // Schedule stats
      triggers_fired: "Times triggered: ",
      events_processed: "Events handled: ",
      delivered: "Delivered: ",
      failed_label: "Failed: ",
      loading: "Loading schedules...",
      empty: "No scheduled agents found.",
      empty_hint: "Create a schedule or polling trigger on any agent to see it here.",
      // Schedule grouping bucket labels (by time until next run)
      group_overdue: "Overdue",
      group_15min: "Next 15 minutes",
      group_1hour: "Next hour",
      group_6hours: "Next 6 hours",
      group_24hours: "Next 24 hours",
      group_later: "Later",
      group_paused: "Paused / Unscheduled",
      // Inline schedule row labels
      run_now: "Run now",
      change_frequency: "Change frequency",
      pause_schedule: "Pause schedule",
      resume_schedule: "Resume schedule",
      // "headless" = agent runs without UI interaction
      headless_badge: "background",
    },

    // Frequency editor modal (change schedule frequency)
    frequency_editor: {
      title: "Change Frequency",
      current: "Current: ",
      quick_presets: "Quick presets",
      cron_expression: "Schedule expression",
      interval_seconds: "Repeat every (seconds)",
      previewing: "Previewing...",
      next_runs: "Next runs",
      invalid_cron: "Invalid schedule expression",
    },

    // Skipped/missed execution recovery panel
    recovery: {
      // {count} = number of agents that missed runs
      agents_missed_one: "{count} agent missed executions",
      agents_missed_other: "{count} agents missed executions",
      // {count} = total missed runs
      total_skipped: "~{count} total runs skipped while app was offline",
      // {count} = missed count, {time} = relative time since last run
      missed_since: "{count} missed since {time}",
      // {interval} = human-readable interval (e.g. "5 minutes")
      every_interval: "every {interval}",
      mark_for_recovery: "Mark for recovery",
      recover: "Recover",
      run_once: "Run 1x",
      run_once_tooltip: "Run once now",
      skip_tooltip: "Skip -- don't recover",
      dismiss_all: "Dismiss all",
      // {count} = number of agents selected for recovery
      recover_selected: "Recover {count} selected",
    },

    // SLA / reliability dashboard
    sla: {
      title: "Agent Reliability",
      subtitle: "How well your agents are performing -- success rates, response times, and auto-recovery across all agents",
      loading: "Loading reliability data...",
      no_data: "No execution data available.",
      // Summary stat labels
      success_rate: "Success Rate",
      // {successful}/{total} execution count
      executions_summary: "{successful}/{total} executions",
      avg_latency: "Avg Response Time",
      // {count} = number of active agents
      active_agents: "{count} active agents",
      open_issues: "Open Issues",
      // {count} = number of circuit breakers tripped
      circuit_breakers: "{count} auto-paused",
      auto_healed: "Auto-Fixed",
      // {count} = number of known failure patterns
      known_patterns: "{count} known issues",
      // {days} = number of days in the chart range
      daily_success_rate: "Daily Success Rate -- {days} Days",
      per_agent: "Per-Agent Reliability",
      no_agent_data: "No agents have executed in this period.",
      // SLA card metric labels
      metric_successful: "Successful",
      metric_failed: "Failed",
      metric_avg_latency: "Avg Response Time",
      metric_p95_latency: "Slowest 5%",
      metric_cost: "Cost",
      // "MTBF" = Mean Time Between Failures (reliability metric)
      metric_mtbf: "Time Between Failures",
      metric_auto_healed: "Auto-Fixed",
      metric_cancelled: "Cancelled",
    },

    // Knowledge graph dashboard
    knowledge: {
      title: "Knowledge",
      // {count} = total entries in the knowledge graph
      subtitle: "{count} things learned from past runs",
      total_patterns: "Total Learnings",
      tool_sequences: "Action Sequences",
      tool_sequences_hint: "Learned step-by-step workflows",
      failure_patterns: "Known Issues",
      failure_patterns_hint: "Recognized error types",
      model_insights: "AI Model Insights",
      model_insights_hint: "How each AI model performs",
      // Persona filter -- default option to show global data
      all_personas: "All Personas (Global)",
      all_types: "All Types",
      // {date} = selected date for failure drill-down
      failure_drilldown: "Failure drill-down: {date}",
      failure_drilldown_hint: "Showing failure patterns active on or after this date.",
      failure_drilldown_empty: "No matching patterns found -- try selecting a specific persona above.",
      unavailable: "Knowledge data unavailable",
      empty: "No knowledge patterns yet",
      empty_hint: "Run your agents to start building knowledge. Every run teaches the system about workflows, common issues, and what works best.",
      recent_learnings: "Recent Learnings",
      // Knowledge row metric labels
      successes: "Successes",
      failures: "Failures",
      avg_cost: "Avg Cost",
      avg_duration: "Avg Duration",
      pattern_data: "Details",
    },

    // Memory conflict review panel
    conflicts: {
      dismissed: "Conflict dismissed",
      resolved: "Conflict resolved",
      resolve_failed: "Failed to resolve conflict",
      // {count} = number of conflicts
      conflict_count_one: "{count} conflict",
      conflict_count_other: "{count} conflicts",
    },
  },

  // -------------------------------------------------------------------
  //  TEMPLATES -- gallery, detail modals, adoption wizard
  // -------------------------------------------------------------------
  templates: {
    // Gallery view
    gallery: {
      ready_to_deploy: "Ready to Use",
      ready_to_deploy_hint: "Templates with all services connected",
      // {count} = number of times template was adopted
      adopted: "{count} adopted",
      // Badge for popular templates
      popular: "Popular",
      // Readiness filter chips
      filter_all: "All",
      filter_ready: "Ready",
      filter_partial: "Partial",
      // Template card sections
      use_cases: "Use Cases",
      connectors: "Connectors",
      triggers: "Triggers",
      no_flows: "No flows",
      // Readiness percentage tooltip -- {percent}% of connectors are ready
      readiness_tooltip: "{percent}% of services connected",
    },

    // Template card action buttons
    actions: {
      view_details: "View Details",
      adopt: "Adopt",
      // "Try It" = run the template in sandbox mode without full adoption
      try_it: "Try It",
      adopt_as_persona: "Adopt as Persona",
      delete: "Delete",
    },

    // Template detail modal tabs
    detail: {
      tab_overview: "Overview",
      tab_prompt: "Prompt",
      tab_features: "Features",
      tab_raw_json: "Raw JSON",
      // Review status labels
      review_passed: "Passed",
      review_failed: "Failed",
      review_error: "Error",
      // "used reference patterns" = template was generated using known good patterns
      used_references: "Used reference patterns",
      no_design_data: "No design data available",
      no_design_data_hint: "Design data unavailable for this template.",
    },

    // Detail modal -> Overview tab
    detail_overview: {
      use_case_flows: "Use Case Flows",
      suggested_adjustment: "Suggested Adjustment",
      // {attempt}/{max} = which generation attempt this adjustment is from
      adjustment_attempt: "(attempt {attempt}/3)",
      dimension_completion: "Dimension Completion",
      // {score}/{total} dimensions filled
      dimensions_score: "({score}/9 dimensions)",
    },

    // Adoption wizard (multi-step wizard to adopt a template as an agent)
    adoption: {
      title: "Adopt Template",
      // Tooltip on the close button during processing
      close_processing: "Close (processing continues in background)",

      // Wizard sidebar step labels (short -- shown in narrow sidebar)
      step_capabilities: "Pick capabilities",
      step_credentials: "Link credentials",
      step_preferences: "Set preferences",
      step_generate: "Generate persona",
      step_review: "Review & save",
    },

    // Adoption -> Choose step (select use cases from the template)
    choose: {
      select_use_cases: "Select Use Cases",
      clear_all: "Clear All",
      select_all: "Select All",
      choose_hint: "Choose which capabilities to include. Deselected use cases and their connectors will be excluded.",
      // Section labels within a use case
      components: "Components",
      examples: "Examples",
      tools: "Tools",
      // Warning when no use cases are selected
      none_selected: "No use cases selected -- select at least one to continue",
    },

    // Adoption -> Connect step (link credentials to template connectors)
    connect: {
      all_set: "No connectors needed -- you're all set!",
      title: "Connect Services",
      subtitle: "Connect your accounts to the services this template needs.",
      service_flow: "How services connect",
      // {configured}/{total} connectors linked
      configured_count: "{configured} of {total} configured",
      // {names} = comma-separated list of missing connector names
      missing: "Missing: {names}",
      // Connector card labels
      built_in: "Built-in",
      select_credential: "Select credential...",
      create_new: "+ Create new credential",
      design_custom: "+ Design custom connector",
      add_credential: "Add credential",
    },

    // Adoption -> Build step (AI generates the persona)
    build: {
      title: "Build Persona",
      subtitle: "Generating persona prompt, tools, triggers, and connectors based on your selections.",
      // Build phase progress labels
      phase_initializing: "Initializing...",
      phase_tools: "Configuring tools...",
      phase_triggers: "Setting up triggers...",
      phase_prompt: "Building persona prompt...",
      phase_connectors: "Connecting services...",
      phase_validating: "Checking everything...",
      phase_finalizing: "Finalizing...",
      phase_generating: "Generating persona...",
      // Shown below progress bar -- {count} connectors being wired
      connector_progress: "{count} connectors",
      // Message shown when user can close the dialog
      close_hint: "You can close this dialog -- processing continues in the background.",
      // Prompt for optional user adjustments to the generated output
      adjustments_label: "Request adjustments (optional)",
      adjustments_placeholder: "Example: Change the schedule to run at 9 AM, remove ClickUp integration, add Slack notifications",
      discard_draft: "Discard draft and start over",
    },

    // Adoption -> Quick adopt confirmation (skip full wizard)
    quick_adopt: {
      all_matched: "All connectors matched",
      // {matched}/{total} connectors that have credentials
      match_summary: "{matched}/{total} connectors linked",
      missing_prefix: "Missing: ",
      add_in_catalog: "add in Keys Catalog",
      build_persona: "Build Persona",
      full_wizard: "Full wizard",
    },

    // Adoption -> Data step (database table setup)
    data: {
      title: "Data Setup",
      subtitle: "This template requires database tables. Choose to create new tables or use existing ones.",
      tables_exist: "Tables already exist",
      // {tables} = comma-separated list of table names
      tables_found: "{tables} found in the built-in database.",
      create_new: "Create New Tables",
      use_existing: "Use Existing Tables",
      complete: "Data setup complete",
    },

    // Adoption -> Tune step (configure template variables, triggers, review policy)
    tune: {
      title: "Configure Persona",
      subtitle: "Set template variables, triggers, review policy, and memory.",
      required_hint: "Required fields marked below.",
      analyzing: "Analyzing template for configuration questions...",
      // Template variables card
      variables_title: "Template Configuration",
      select_placeholder: "Select...",
      // Trigger setup card
      trigger_title: "Trigger Setup",
      no_triggers: "No triggers selected",
      // Cron/schedule trigger
      when_label: "When should this run?",
      cron_placeholder: "Every weekday at 9am",
      cron_hint: "Plain English (e.g. \"Every weekday at 9am\") or a schedule expression (e.g. \"0 9 * * 1-5\")",
      // Webhook trigger
      webhook_url: "Webhook URL",
      webhook_placeholder: "https://...",
      // Polling trigger
      check_interval: "Check interval",
      check_interval_placeholder: "Every 5 minutes",
      // Manual trigger
      manual_hint: "Triggered manually -- no configuration needed",
      // System event trigger
      system_hint: "Triggered by system events -- no configuration needed",
    },

    // Adoption -> Tune step -> Human review card
    review_policy: {
      title: "Human Review",
      require_approval: "Require approval",
      sandbox: "Sandbox",
      // "Pause before executing actions" = require human approval before agent takes actions
      pause_hint: "Pause before executing actions",
      auto_approve: "Auto-approve",
      auto_approve_hint: "Skip review for lower severity",
      // Severity threshold options
      severity_info: "Info only",
      severity_info_warning: "Info + Warning",
      severity_all: "All (no review)",
      review_timeout: "Review timeout",
      auto_reject: "Auto-reject after timeout",
      timeout_1h: "1 hour",
      timeout_4h: "4 hours",
      timeout_24h: "24 hours",
      timeout_none: "No timeout",
    },

    // Adoption -> Tune step -> Memory card
    memory: {
      title: "Memory",
      description: "Persona retains learned patterns and preferences across runs",
      enabled: "Memory enabled",
      scope_label: "Memory scope",
      scope_hint: "What should the persona remember?",
      scope_everything: "Everything (default)",
      scope_preferences: "User preferences only",
      scope_patterns: "Execution patterns",
      scope_errors: "Error resolutions",
      scope_custom: "Custom scope...",
      scope_custom_placeholder: "Describe what to remember...",
    },

    // Adoption -> Create/Review step (final review before creating the agent)
    create: {
      use_cases: "Use Cases",
      tools_and_connectors: "Tools & Connectors",
      waiting: "Waiting for persona draft...",
      title: "Review & Create",
      subtitle: "Review the generated persona, then create it.",
      // Identity card defaults
      unnamed: "Unnamed Persona",
      no_description: "No description provided",
      all_ready: "All connectors ready",
      // {ready}/{total} connectors with valid credentials
      ready_count: "{ready}/{total} ready",
      // Readiness checklist
      will_create: "Will create: 1 persona",
      // {count} = number of each item type
      with_tools_one: ", {count} tool",
      with_tools_other: ", {count} tools",
      with_triggers_one: ", {count} trigger",
      with_triggers_other: ", {count} triggers",
      with_connectors_one: ", {count} connector subscription",
      with_connectors_other: ", {count} connector subscriptions",
      check_name: "Name",
      check_prompt: "Prompt",
      check_connectors: "Connectors",
      // Safety scan findings
      safety_issues: "Safety issues",
      // {count} = number of critical safety findings
      safety_acknowledge_one: "I acknowledge {count} critical safety finding and accept the risk",
      safety_acknowledge_other: "I acknowledge {count} critical safety findings and accept the risk",
      edit_details: "Edit Details",
    },

    // Adoption -> Review sections (collapsible sections in the review step)
    review: {
      // {count} = number of items in each section
      use_cases_header: "Use Cases ({count})",
      tools_header: "Tools ({count})",
      triggers_header: "Triggers ({count})",
    },

    // PersonaMatrix build phases (AI-guided agent building in the gallery)
    matrix: {
      // Build phase labels
      preparing: "Preparing build...",
      analyzing: "Analyzing your intent...",
      building: "Building agent dimensions...",
      waiting_input: "Waiting for your input...",
      draft_ready: "Draft ready for review",
      testing: "Testing agent...",
      test_complete: "Test complete",
      promoted: "Agent promoted",
      build_failed: "Build failed",
      // Cell dimension labels
      dim_tasks: "Tasks",
      dim_apps: "Apps & Services",
      dim_schedule: "When It Runs",
      dim_review: "Human Review",
      dim_memory: "Memory",
      dim_errors: "Error Handling",
      dim_messages: "Messages",
      dim_events: "Events",
      // Build progress
      generating: "Generating...",
      continue_build: "Continue Build",
      all_resolved: "All Dimensions Resolved",
      // {count} = number of answers ready
      answers_ready: "{count} answer(s) ready -- click Continue",
      input_needed: "Your input needed",
      // {answered}/{remaining} = question counts
      answer_progress: "{answered} answered, {remaining} remaining",
      // Cell badges
      cell_edit: "Edit",
      cell_done: "Done",
      // Testing controls
      cancel_test: "Cancel Test",
      test_agent: "Test Agent",
      starting_test: "Starting Test...",
      // Review actions
      apply_changes: "Apply Changes",
      discard: "Discard",
      build_complete: "Build Complete",
      adjust_placeholder: "Adjust anything...",
      answer_placeholder: "Your answer...",
    },

    // Sandbox/trust warning banners
    sandbox: {
      // Sandbox restriction labels
      restriction_events: "Cannot send events",
      restriction_chains: "Cannot trigger other agents",
      restriction_webhooks: "Cannot receive web notifications",
      restriction_polling: "Cannot auto-check for changes",
      restriction_review: "Needs your approval before acting",
      restriction_budget: "Spending limit enforced",
      // {max} = maximum concurrent runs allowed
      restriction_concurrent_one: "Max {max} concurrent run",
      restriction_concurrent_other: "Max {max} concurrent runs",
      // Banner titles -- "Unverified" = from unknown source, "Community" = from community
      title_unverified: "Unverified Template",
      title_community: "Community Template -- Restricted Mode",
      // Banner descriptions
      desc_unverified: "This template comes from an unknown source and has not been verified. It will run with restricted capabilities to protect your system.",
      desc_community: "This community template has not been officially verified. It will run in restricted mode with limited capabilities.",
      // Compact badge labels
      badge_unverified: "Unverified",
      badge_sandbox: "Restricted Mode",
    },
  },

  // -------------------------------------------------------------------
  //  TRIGGERS -- event triggers, chains, subscriptions
  // -------------------------------------------------------------------
  triggers: {
    title: "Triggers & Automations",
    subtitle: "Set up what causes your agents to run automatically",
    // Tab labels
    tab_triggers: "Triggers",
    tab_chains: "Automations",
    tab_subscriptions: "Subscriptions",
    // Health indicator tooltips
    health_failing: "One or more triggers failing",
    health_degraded: "One or more triggers degraded",
    // Trigger category selector
    category_label: "Trigger Category",
    category_manual: "Manual",
    category_manual_hint: "Run on demand",
    // Trigger type selector
    type_label: "Trigger Type",
    // Quick templates section
    quick_templates: "Quick Templates",

    // Trigger type display labels (shown in trigger rows and summaries)
    type_schedule: "Schedule",
    type_webhook: "Webhook",
    type_polling: "Auto-Check",
    type_event_listener: "Event Listener",
    type_file_watcher: "File Watcher",
    type_clipboard: "Clipboard",
    type_app_focus: "App Focus",
    type_composite: "Combined",

    // Trigger status summary (collapsed row config badges)
    webhook_listener: "webhook listener",
    custom_endpoint: "custom endpoint",
    // {interval} = human-readable interval (e.g. "5 minutes")
    every_interval: "every {interval}",
    // {source} = event source filter
    from_source: "from {source}",

    // Schedule config form
    schedule: {
      interval_label: "Interval",
      // Interval preset labels
      preset_1m: "1 min",
      preset_5m: "5 min",
      preset_15m: "15 min",
      preset_1h: "1 hour",
      preset_6h: "6 hours",
      preset_24h: "24 hours",
      custom: "Custom",
      // Schedule mode toggle
      mode_interval: "Interval",
      mode_cron: "Cron",
      // Cron config
      cron_label: "Schedule Expression",
      cron_placeholder: "0 9 * * 1-5",
      cron_loading: "Previewing...",
      // Cron presets
      cron_weekday_9am: "Weekdays 9am",
      cron_every_hour: "Every hour",
      cron_daily_midnight: "Daily midnight",
      cron_weekly_monday: "Weekly Monday",
      // Schedule preview
      next_runs: "Next runs",
      invalid_cron: "Invalid schedule expression",
    },

    // Trigger add form
    add: {
      create_trigger: "Create Trigger",
      creating: "Creating...",
    },

    // Trigger detail drawer
    detail: {
      // Action buttons
      test_fire: "Test Fire",
      test_firing: "Firing...",
      validate_and_fire: "Validate trigger config, then fire",
      validating: "Validating...",
      dry_run: "Test Run",
      dry_running: "Running...",
      simulate_hint: "Preview what would happen without actually running",
      simulating: "Simulating...",
      delete: "Delete",
      delete_confirm: "Confirm delete",
      delete_trigger: "Delete trigger",
      // Activity log section
      activity_log: "Activity Log",
      no_activity: "No activity recorded yet",
      // Webhook details
      webhook_url: "Webhook URL",
      webhook_secret: "Security Key",
      copied: "Copied!",
      copy_curl: "Copy sample curl",
      // Execution history section
      last_fired: "Last fired",
      never_fired: "Never fired",
      // {count} = number of times trigger has fired
      fire_count_one: "Fired {count} time",
      fire_count_other: "Fired {count} times",
    },

    // Trigger list (main list view)
    list: {
      empty_title: "No triggers configured yet",
      empty_hint: "Triggers let your agents run automatically -- on a schedule, when a file changes, when data arrives, and more.",
      create_first: "Create Your First Trigger",
      // Section header
      event_triggers: "Event Triggers",
      // Trigger row
      budget_unavailable: "Budget data unavailable",
      unknown_budget: "Unknown Budget",
      budget_exceeded: "Monthly budget exceeded -- trigger paused",
      budget: "Budget",
    },

    // Trigger config panel (within agent editor)
    config: {
      no_persona: "No persona selected",
      title: "Triggers",
      add_trigger: "Add Trigger",
      empty: "No triggers configured. Add one to automate this persona.",
    },

    // Trigger countdown (time until next fire)
    countdown: {
      due_now: "Due now",
      // {time} = relative countdown (e.g. "5m", "2h 30m")
      fires_in: "Fires in {time}",
    },

    // Polling trigger config
    polling: {
      endpoint_label: "URL to Check",
      endpoint_placeholder: "https://api.example.com/status",
      // {interval} = polling interval
      check_interval: "Check every {interval}",
      content_hash: "Detect changes only",
    },

    // Webhook trigger config
    webhook: {
      url_label: "Webhook URL",
      secret_label: "Security Key (optional)",
      secret_placeholder: "Secret key to verify incoming data",
    },

    // File watcher trigger config
    file_watcher: {
      paths_label: "Watch Paths",
      path_placeholder: "/path/to/watch",
      add_path: "Add path",
      events_label: "File Events",
      event_modify: "Modify",
      event_create: "Create",
      event_delete: "Delete",
      recursive: "Recursive",
      glob_filter: "File Pattern",
      glob_placeholder: "*.json",
    },

    // Clipboard trigger config
    clipboard: {
      content_type: "Content Type",
      type_text: "Text",
      type_image: "Image",
      pattern_label: "Match Pattern",
      pattern_placeholder: "e.g. https?://.*",
      interval_label: "Check Interval (seconds)",
    },

    // App focus trigger config
    app_focus: {
      app_names_label: "Application Names",
      app_placeholder: "e.g. Chrome, Firefox",
      add_app: "Add app",
      title_pattern: "Window Title Pattern",
      title_placeholder: "e.g. .*GitHub.*",
      interval_label: "Check Interval (seconds)",
    },

    // Event listener trigger config
    event_listener: {
      event_type_label: "Event Type",
      event_type_placeholder: "e.g. persona.execution.completed",
      source_filter_label: "Source Filter",
      source_filter_placeholder: "e.g. persona:abc123",
    },

    // Composite trigger config
    composite: {
      conditions_label: "Conditions",
      add_condition: "Add condition",
      operator_all: "All conditions must match",
      operator_any: "Any condition can match",
      window_label: "Time Window (seconds)",
    },

    // Rate limit controls
    rate_limit: {
      title: "Speed Limits",
      max_fires: "Max runs",
      per_window: "Time period",
      window_seconds: "{seconds}s",
      window_minutes: "{minutes}m",
      window_hours: "{hours}h",
      currently_limited: "Currently paused (limit reached)",
    },

    // Dry run result display
    dry_run: {
      title: "Test Run Result",
      would_fire: "Would run",
      would_not_fire: "Would not run",
      matched_conditions: "Conditions met",
      payload_preview: "Data preview",
    },
  },

  // -------------------------------------------------------------------
  //  PIPELINE / TEAMS -- multi-agent team pipelines
  // -------------------------------------------------------------------
  teams: {
    title: "Agent Teams",
    subtitle: "Combine agents into teams that work together on multi-step tasks",
    // "Auto-Team" = AI automatically groups agents into a team
    auto_team: "Auto-Team",
    new_team: "New Team",
    // Template gallery section
    starter_templates: "Starter Templates",
    use_template: "Use Template",
  },

  // -------------------------------------------------------------------
  //  SETTINGS -- account, appearance, notifications, engine, data
  // -------------------------------------------------------------------
  settings: {
    title: "Settings",

    account: {
      title: "Account",
      subtitle: "Manage your sign-in and profile",
      offline: "Offline",
      sign_out: "Sign out",
      sign_in_prompt: "Sign in to sync your data across devices",
      sign_in_google: "Sign in with Google",
    },

    appearance: {
      subtitle: "Customize how the app looks",
      dark: "Dark",
      light: "Light",
      text_size: "Text Size",
    },

    notifications: {
      // Severity level descriptions (shown in notification settings)
      // "Circuit breaker tripped" = an agent was auto-disabled due to repeated failures
      severity_critical: "Agent auto-paused due to repeated failures, required tools not found",
      severity_high: "Login errors, usage limits reached, timeout retries exhausted",
      severity_medium: "Speed limits, timeouts with retries remaining (usually fixes itself)",
      severity_low: "Informational issues",
      // Weekly digest toggle
      weekly_digest: "Weekly Health Digest",
      digest_title: "Agent Health Digest",
      digest_description: "Weekly notification summarizing health issues across all agents with a total health score",
      // Healing alerts section
      healing_alerts_hint: "Control which auto-fix alerts trigger notifications",
      healing_severity: "Auto-Fix Alert Level",
      // Explanation of how desktop notifications work
      notification_hint: "Desktop notifications use the native OS notification system. In-app toasts appear for critical and high severity issues regardless of these settings.",
    },

    engine: {
      loading_capabilities: "Loading AI capabilities...",
      detecting_providers: "Finding installed AI providers...",
      subtitle: "Choose which AI provider handles each type of task",
      capability_map: "Task Assignment Map",
      reset_defaults: "Reset to defaults",
      // Provider status labels
      provider_installed: "installed",
      provider_missing: "missing",
      // Legend labels
      legend: "Legend",
      legend_enabled: "Enabled",
      legend_unsupported: "Unsupported (locked)",
      legend_not_installed: "Not installed",
      // Explanation of how defaults were determined
      defaults_heading: "How Defaults Were Chosen",
      defaults_description: "The default assignments are based on thorough testing of each AI provider. Changing a provider for a task it wasn't tested for may cause errors. Claude Code is the only provider that works with all task types.",
    },
  },

  // -------------------------------------------------------------------
  //  DESIGN -- AI design wizard, persona compilation stages
  // -------------------------------------------------------------------
  design: {
    no_persona: "No persona selected",

    // Compilation stage labels -- shown during AI-powered persona generation
    stages: {
      assembling_label: "Preparing instructions",
      assembling_desc: "Putting together the agent instructions from your settings",
      generating_label: "Generating with AI",
      generating_desc: "Running Claude to create the agent design",
      parsing_label: "Reading results",
      parsing_desc: "Processing the AI response into a usable format",
      checking_label: "Checking everything works",
      checking_desc: "Making sure the suggested tools and services are available",
      saving_label: "Saving result",
      saving_desc: "Saving the finished design",
    },
  },

  // -------------------------------------------------------------------
  //  PROMPT LAB -- prompt versioning, A/B testing, performance charts
  // -------------------------------------------------------------------
  prompt_lab: {
    title: "Prompt Versions",
    no_persona: "No persona selected",
    // Filter tabs for prompt version list
    filter_all: "All",
    filter_production: "Production",
    filter_experimental: "Experimental",
    filter_archived: "Archived",
    // Sort toggle labels
    sort_newest: "Newest first",
    sort_oldest: "Oldest first",
    sort_new: "New",
    sort_old: "Old",
    // Empty states
    no_versions: "No versions yet",
    no_versions_hint: "Versions are created automatically when you edit the prompt",
    // {filter} = current filter name (e.g. "production", "archived")
    no_filter_versions: "No {filter} versions",
    show_all: "Show all versions",
    // Compare panel
    compare_title: "Compare prompt versions",
    compare_hint: "See exactly what changed between two versions side-by-side. Pick any two from the list, or let us auto-select.",
    start_comparing: "Start comparing",
    need_two_versions: "Create at least two versions to compare them",
    or_click: "or click",
    // Sub-tab labels within prompt lab
    tab_compare: "Compare",
    tab_ab_test: "A/B Test",
    tab_health: "Health",
    tab_performance: "Performance",

    // A/B Test panel
    ab_test: {
      title: "A/B test your prompts",
      description: "Compare two prompt versions head-to-head. See which one performs better on cost, speed, and output quality.",
      select: "Select",
      versions_to_begin: "versions to begin",
      test_input: "Test Input (optional JSON)",
      test_input_placeholder: "{\"task\": \"Summarize the latest sales report\"}",
      running: "Running A/B Test...",
      run: "Run A/B Test",
      failed: "A/B Test Failed",
      completed: "A/B test completed successfully",
    },

    // Auto-rollback settings panel
    rollback: {
      title: "Error Rate Monitor",
      last_10: "Last 10 executions",
      rollback_hint: "If error rate exceeds 50% after a prompt change, rollback to the production version using the version list above.",
      waiting: "Waiting for execution data",
      waiting_hint: "Run your agent a few times to start tracking error rates. The monitor needs at least one execution to calculate health.",
      check_again: "Check again",
    },

    // Performance charts
    performance: {
      cost_per_execution: "Cost per Run",
      cost_delta: "Cost Change",
      prod_baseline: "current version",
      latency_distribution: "Response Time Spread",
      latency_delta: "Speed Change",
      error_rate_trend: "Error Rate Over Time",
      error_delta: "Error Change",
    },
  },

  // -------------------------------------------------------------------
  //  TESTS -- sandbox test runner, test suites
  // -------------------------------------------------------------------
  tests: {
    title: "Test Runner",
    subtitle: "Test your agent with different AI models using auto-generated scenarios",
    // Warnings shown when agent is missing configuration
    no_prompt: "This persona has no prompt configured. Add a prompt first.",
    no_tools: "This persona has no tools assigned. Add tools for richer testing.",
    // Use case focus selector
    focus_label: "Focus on Use Case",
    all_use_cases: "All Use Cases",
    // {description} = selected use case description
    focus_hint: "Scenarios will target: {description}",
    // Run controls
    cancel_run: "Cancel Test Run",
    // {count} = number of selected models
    run_test_one: "Run Test ({count} model...)",
    run_test_other: "Run Test ({count} models...)",
    // Test suite manager
    suites: {
      title: "Saved Test Suites",
      save_button: "Save Scenarios",
      // {count} = number of generated scenarios to save
      save_hint: "Save the {count} generated scenarios as a reusable test suite.",
      name_placeholder: "Suite name (optional)",
      empty: "No saved test suites",
      empty_hint: "Run a test to generate scenarios, then save them here",
      // {count} = scenario count in a suite
      scenario_count_one: "{count} scenario",
      scenario_count_other: "{count} scenarios",
      rerun_tooltip: "Re-run this suite",
      rename_tooltip: "Rename",
      delete_tooltip: "Delete suite",
      no_scenarios: "No scenarios in this suite",
    },
    // Progress panel during test execution
    progress: {
      generating: "Generating test scenarios...",
      // {model} = model name, {scenario} = scenario name
      testing: "Testing {model} -- {scenario}",
      tool_prefix: "Tool: ",
      output_prefix: "Output: ",
      protocol_prefix: "Protocol: ",
    },
  },

  // -------------------------------------------------------------------
  //  ONBOARDING -- first-use setup flow
  // -------------------------------------------------------------------
  onboarding: {
    title: "Get Started",
    subtitle: "Create and run your first agent",
    skip_tooltip: "Skip onboarding",
    opening_wizard: "Setting up your agent...",
    skip_button: "Skip",
    adopt_button: "Set Up Agent",
    continue_button: "Continue",
    done_button: "Done",
    scanning_tooltip: "Scanning your desktop apps...",
    select_template_tooltip: "Select a template first",
    step_appearance: "Look & Feel",
    step_discover: "Desktop",
    step_pick_template: "Pick Template",
    step_adopt: "Set Up Agent",
    step_execute: "First Run",
    desktop_title: "Your desktop environment",
    desktop_description: "We found these apps on your machine. Allow access so your agents can interact with them directly.",
    desktop_empty: "No supported desktop apps detected.",
    desktop_empty_hint: "You can connect desktop apps later from the Connections section.",
    risk_review: "Review recommended",
    risk_review_tooltip: "This app can run commands on your system — review before allowing",
    risk_safe: "Safe to allow",
    risk_safe_tooltip: "Read-only access, safe to allow",
  },

  // -------------------------------------------------------------------
  //  SYSTEM HEALTH -- environment checks (shown during first use)
  // -------------------------------------------------------------------
  system_health: {
    title: "System Checks",
    subtitle: "Verifying your environment is ready",
    rerun: "Re-run checks",
    // Health check category labels
    category_local: "Local Environment",
    category_agents: "Agents",
    category_cloud: "Cloud Deployment",
    category_account: "Account",
    // Error states
    bridge_error: "The application bridge is not responding. Try restarting the app. You can still continue to explore the interface.",
    partial_error: "Some checks reported issues. You can still continue, but some features may not work correctly.",
    // Optional configuration sections
    ollama_title: "Ollama Cloud API Key",
    ollama_hint: "Optional -- unlocks free cloud models (Qwen3 Coder, GLM-5, Kimi K2.5) for all agents.",
    save_key: "Save Key",
    litellm_title: "LiteLLM Proxy Configuration",
    litellm_hint: "Optional -- route agents through your LiteLLM proxy for model management and cost tracking.",
    save_config: "Save Configuration",
    litellm_note: "These settings are stored locally and shared across all agents configured to use the LiteLLM provider.",
    // Crash logs section
    crash_logs: "Crash Logs",
    no_crash_logs: "No crash logs recorded.",
    crash_auto_cred: "Auto-cred session",
    crash_rust_panic: "Rust panic",
    // Footer actions
    install_all: "Install All Dependencies",
    ready_title: "Ready to create your first agent?",
    ready_hint: "All checks passed. Let us guide you through creating and running your first agent.",
    get_started: "Get Started",
    // Install buttons
    install_nodejs: "Install Node.js",
    install_cli: "Install Claude CLI",
    downloading: "Downloading...",
    installing: "Installing...",
    installed_success: "Installed successfully",
    installation_failed: "Installation failed",
    try_manual: "Try running manually:",
    official_page: "Official page",
    // Section card actions
    edit_key: "Edit Key",
    edit_config: "Edit Config",
    signing_in: "Signing in...",
  },

  // -------------------------------------------------------------------
  //  COMMAND PALETTE -- global search/command launcher (Ctrl+K)
  // -------------------------------------------------------------------
  command_palette: {
    placeholder: "Search agents, navigate... (type \">\" for commands)",
    // Section headers in search results
    commands: "Commands",
    recent_agents: "Recent Agents",
    navigation: "Navigation",
    agents_section: "Agents",
    // Built-in command labels
    create_agent: "Create New Agent",
    // {label} = navigation destination name
    go_to: "Go to {label}",
    // Keyboard hint labels (bottom bar of palette)
    key_esc: "ESC",
    hint_navigate: "navigate",
    hint_select: "select",
    hint_commands: "commands",
  },

  // -------------------------------------------------------------------
  //  SHARED COMPONENTS -- error boundary, empty states, banners
  // -------------------------------------------------------------------
  errors: {
    // Error boundary -- shown when a component crashes
    // {name} = component or section name that crashed
    boundary_title: "Something unexpected happened in {name}",
    boundary_title_generic: "Something unexpected happened",
    boundary_body: "Don't worry -- your data is safe. You can try again or head back to the dashboard.",
    boundary_retry: "Try Again",
    boundary_dashboard: "Go to Dashboard",
    boundary_copy: "Copy report for support",
    boundary_copied: "Copied to clipboard",
    boundary_dev: "For developers",
    boundary_no_stack: "No stack trace available",

    // Error banner
    go_back: "Go back",
    dismiss_error: "Dismiss error",

    // Backend error kind -> user message mapping
    not_found: "The requested resource was not found",
    validation: "Invalid input: {detail}",
    auth: "Authentication failed -- check your credentials",
    rate_limited: "Too many requests -- please wait a moment and try again",
    network_offline: "No internet connection",
    database: "Database error -- please restart the app",
    internal: "An unexpected error occurred",
    cloud_error: "Cloud service error: {detail}",
    gitlab_error: "GitLab error: {detail}",
  },

  // -------------------------------------------------------------------
  //  ERROR REGISTRY -- user-friendly error messages with recovery hints.
  //  Each entry has a `message` (what happened) and `suggestion` (what to do).
  //  Keys mirror the match patterns in src/lib/errors/errorRegistry.ts.
  //  Used by useTranslatedError() hook for localized error display.
  // -------------------------------------------------------------------
  error_registry: {
    // Network & connectivity
    network_offline_message: "You appear to be offline.",
    network_offline_suggestion: "Check your internet connection and try again.",
    timed_out_message: "The request took too long to complete.",
    timed_out_suggestion: "Try again — if the problem persists, simplify your request or check your connection.",
    http_client_message: "Could not establish a network connection.",
    http_client_suggestion: "Check your internet connection and firewall settings.",
    // Auth & permissions
    auth_invalid_message: "Your session has expired or is invalid.",
    auth_invalid_suggestion: "Sign out and sign back in to refresh your session.",
    session_expired_message: "Your session has expired.",
    session_expired_suggestion: "Sign in again to continue.",
    oauth_timeout_message: "The authorization window was open too long.",
    oauth_timeout_suggestion: "Try connecting again and complete the sign-in promptly.",
    permission_denied_message: "You don't have permission to perform this action.",
    permission_denied_suggestion: "Check that you have the right access level, or ask an admin for help.",
    forbidden_message: "Access denied.",
    forbidden_suggestion: "You may not have permission for this action. Check your credentials or contact an admin.",
    // Rate limiting
    rate_limit_message: "Too many requests — slow down.",
    rate_limit_suggestion: "Wait a moment and try again.",
    rate_limited_message: "You've hit a rate limit.",
    rate_limited_suggestion: "Wait a few seconds before retrying.",
    // Budget
    budget_limit_message: "This agent has reached its spending limit for the month.",
    budget_limit_suggestion: "Increase the budget in Settings or wait until the next billing cycle.",
    budget_exceeded_message: "Budget limit reached — execution was blocked.",
    budget_exceeded_suggestion: "Adjust the agent's monthly budget to continue.",
    // CLI / backend
    cli_not_found_message: "The AI backend (Claude CLI) is not installed.",
    cli_not_found_suggestion: "Install the Claude CLI and restart the app.",
    cli_config_conflict_message: "A configuration conflict is blocking the AI backend.",
    cli_config_conflict_suggestion: "Restart the app — this usually resolves automatically.",
    cli_error_message: "The AI backend returned an unexpected error.",
    cli_error_suggestion: "Try again. If it keeps happening, check the Claude CLI logs.",
    cli_no_output_message: "The AI did not return a response.",
    cli_no_output_suggestion: "Try again with a simpler request.",
    // Design / generation
    connector_design_message: "Could not generate a connector from your description.",
    connector_design_suggestion: "Be more specific — include the service name and credential type (e.g. \"Stripe API key\").",
    generation_failed_message: "Generation failed.",
    generation_failed_suggestion: "Try rephrasing your request with more detail.",
    // Validation
    invalid_json_message: "The data format is invalid.",
    invalid_json_suggestion: "Check that your input is properly formatted and try again.",
    validation_message: "Some input values are invalid.",
    validation_suggestion: "Review the highlighted fields and correct any errors.",
    body_too_large_message: "The data you're sending is too large.",
    body_too_large_suggestion: "Reduce the size of your input and try again.",
    // Encryption
    decryption_message: "Could not decrypt — the passphrase may be wrong or the file is corrupted.",
    decryption_suggestion: "Double-check your passphrase and try again.",
    // Circular chains
    circular_chain_message: "This would create a loop where agents trigger each other endlessly.",
    circular_chain_suggestion: "Review your agent chain and remove the circular reference.",
    // Database / connection
    not_found_message: "The requested item could not be found.",
    not_found_suggestion: "It may have been deleted. Refresh and try again.",
    connection_limit_message: "Too many active connections.",
    connection_limit_suggestion: "Disconnect an existing peer before adding a new one.",
    // Webhooks / automation
    webhook_error_message: "The external service returned an error.",
    webhook_error_suggestion: "Check that the webhook URL is correct and the service is available.",
    zapier_message: "Could not reach the Zapier webhook.",
    zapier_suggestion: "Verify the webhook URL in your Zapier integration settings.",
    inactive_message: "This automation is currently disabled.",
    inactive_suggestion: "Activate the automation before running it.",
    no_webhook_message: "No webhook URL has been set up for this automation.",
    no_webhook_suggestion: "Add a webhook URL in the automation settings.",
    no_credential_message: "This automation is missing its credentials.",
    no_credential_suggestion: "Add the required credential in the automation settings.",
    // Import / export
    empty_bundle_message: "The import file is empty or damaged.",
    empty_bundle_suggestion: "Try re-exporting from the source and importing again.",
    invalid_bundle_message: "This file doesn't appear to be a valid export bundle.",
    invalid_bundle_suggestion: "Make sure you're importing a file that was exported from this app.",
    // Generic fallback
    generic_message: "Something went wrong.",
    generic_suggestion: "Try again. If the problem persists, restart the app or check your connection.",
    // Severity labels (for healing / alert toasts)
    severity_critical: "Needs immediate attention",
    severity_high: "Important issue",
    severity_medium: "Minor issue",
    severity_low: "Informational",
  },

  // -------------------------------------------------------------------
  //  EMPTY STATES -- contextual guidance when a section has no content
  // -------------------------------------------------------------------
  empty_states: {
    // Credentials empty state (shown in agent editor when no keys are linked)
    credentials_title: "Your agents need credentials to run",
    credentials_subtitle: "Add API keys and service connections so your agents can interact with external tools.",
    // Triggers empty state
    triggers_title: "This agent runs manually only",
    triggers_subtitle: "Add a trigger to automate it -- run on a schedule, when data arrives, or when something changes.",
    // Executions empty state (with onboarding steps)
    executions_title: "No executions yet",
    executions_subtitle: "Get started in three steps to see activity here.",
    step_create: "Create an agent",
    step_credential: "Add a credential",
    step_run: "Run your agent",
    // Events/subscriptions empty state
    events_title: "No event subscriptions yet",
    events_subtitle: "Subscribe to events so this agent reacts automatically when things happen.",
    // Tools/connectors empty state
    tools_title: "No tools or services connected",
    tools_subtitle: "Connect external services so your agent can take actions and access data.",
    // Use cases empty state
    use_cases_title: "No use cases defined yet",
    use_cases_subtitle: "Define what this agent should do -- import from a workflow or describe it in plain language.",
  },

  // -------------------------------------------------------------------
  //  CLI OUTPUT -- terminal panel for CLI process output
  // -------------------------------------------------------------------
  cli: {
    idle: "No CLI output yet.",
    waiting: "Waiting for Claude CLI output...",
  },

  // -------------------------------------------------------------------
  //  VALIDATION -- form validation messages
  //  {field} = the field label, {min} = minimum value/length
  // -------------------------------------------------------------------
  validation: {
    required: "{field} is required",
    min_length: "{field} must be at least {min} characters",
    min_value: "{field} must be at least {min}",
    invalid_cron: "Invalid schedule expression",
    invalid_separator: "The filter contains an invalid separator",
    passphrase_min: "Passphrase must be at least 8 characters",
    passphrase_prompt: "Please enter the passphrase used during export",
    at_least_one: "At least one {field} is required",
    fill_one_field: "Fill in at least one field to save",
  },

  // -------------------------------------------------------------------
  //  TOASTS -- transient notification messages (snackbar-style)
  //  Keep short -- these disappear after a few seconds.
  // -------------------------------------------------------------------
  toasts: {
    copied: "Copied to clipboard",
    // {name} = the name of the duplicated agent
    duplicated: "Duplicated as \"{name}\"",
    memory_created: "Memory created successfully",
    // {label} = the fix that was applied (e.g. "retry connection")
    fix_applied: "Applied fix: {label}",
    // {error} = error message from the system
    fix_failed: "Failed to apply fix: {error}",
    credential_saved: "Credential saved",
    persona_deleted: "Agent deleted",

    // Agent operations
    generation_failed: "Failed to generate agent -- check your connection",
    config_save_failed: "Failed to save configuration",
    model_switch_failed: "Failed to switch model",
    toggle_failed: "Failed to toggle agent",
    duplicate_failed: "Failed to duplicate agent",

    // Execution feedback
    // {id} = execution ID
    cloud_execution_started: "Cloud execution started: {id}",
    cloud_execution_failed: "Failed to start cloud execution",
    execution_started: "Execution started: {id}",
    execution_failed: "ERROR: Failed to start execution",
    retry_chain_failed: "Failed to load retry chain for comparison",

    // Prompt lab
    ab_test_completed: "A/B test completed successfully",
    prompt_versions_failed: "Failed to load prompt versions",
    // These are action confirmations for prompt version management
    promoted: "Promoted to production",
    archived: "Archived",
    unarchived: "Unarchived",
    rolled_back: "Rolled back successfully",
    test_suite_remove_failed: "Failed to remove scenario from suite",

    // Trigger operations
    trigger_fire_failed: "Failed to fire trigger",
    // {id} = execution ID started by trigger test
    trigger_config_ok: "Config OK. Execution {id} started",
    // {detail} = validation failure reason
    trigger_validation_failed: "Validation failed -- {detail}",
    dry_run_failed: "Test run failed",
    activity_log_failed: "Failed to load activity log",

    // Schedule operations
    // {name} = agent/schedule name
    budget_exceeded: "Budget exceeded for \"{name}\" -- execution blocked",
    triggered_manually: "Triggered \"{name}\" manually",
    // {name} = schedule name, {error} = error message
    execute_failed: "Failed to execute \"{name}\": {error}",
    schedule_updated: "Updated schedule for \"{name}\"",
    schedule_update_failed: "Failed to update schedule: {error}",
    // {action} = "Paused" or "Resumed", {name} = schedule name
    schedule_toggled: "{action} \"{name}\"",
    schedule_toggle_failed: "Failed to toggle: {error}",
    paused: "Paused",
    resumed: "Resumed",
    // {details} = recovery summary
    recovered: "Recovered {details}",
    recovered_with_failures: "Recovered {success}, failed {failed}",

    // Workflow/background job
    cancel_workflow_failed: "Failed to cancel workflow job",

    // Vault/credentials
    credential_delete_failed: "Failed to delete recipe",
    credentials_expired: "Credentials expired or revoked. Please reconnect to the cloud server.",

    // Automation store
    automations_load_failed: "Failed to load automations",
    automation_create_failed: "Failed to create automation",
    automation_update_failed: "Failed to update automation",
    automation_delete_failed: "Failed to delete automation",
    automation_trigger_failed: "Failed to trigger automation",
    automation_test_failed: "Automation test failed",
    automation_runs_failed: "Failed to load automation runs",
    zapier_load_failed: "Failed to load Zapier zaps",
    zapier_trigger_failed: "Failed to trigger Zapier webhook",

    // Teams/pipeline
    teams_load_failed: "Failed to load teams",
    team_detail_failed: "Failed to load team details",
    scheduled_agents_failed: "Failed to load scheduled agents",

    // Design conversation
    design_start_failed: "Failed to start design conversation",

    // Recipes
    recipe_save_failed: "Failed to save recipe",
    recipe_test_failed: "Quick test failed",
  },

  // -------------------------------------------------------------------
  //  CONSENT -- first-use consent/privacy modal
  //  These are legal/privacy texts -- translate carefully and accurately.
  // -------------------------------------------------------------------
  consent: {
    title: "Welcome to Personas Desktop",
    subtitle: "Please review how this application works before continuing",
    intro: "Personas Desktop is a local-first AI agent orchestration tool. Before you start, please understand what it does and what data it accesses.",

    // Section 1: AI Provider Communication
    ai_title: "AI Provider Communication",
    ai_tldr: "Your prompts are sent to your chosen AI service using your own API key.",
    ai_detail_1: "Your persona prompts, tool definitions, and input data are sent to the selected AI provider (Anthropic Claude, OpenAI Codex, Google Gemini, or GitHub Copilot) for execution.",
    ai_detail_2: "Requests are made over HTTPS to provider APIs. Each provider has its own terms of service and data retention policies.",
    ai_detail_3: "You supply your own API keys; they are encrypted locally and never shared with us.",
    ai_detail_4: "Execution output (including token counts and cost) is stored locally in your database.",

    // Section 2: Local Data Storage
    storage_title: "Local Data Storage",
    storage_tldr: "Your passwords are encrypted and all your data stays on your computer.",
    storage_detail_1: "All data (personas, execution history, logs, memories) is stored in a local SQLite database on your machine.",
    storage_detail_2: "Credential values (API keys, tokens, passwords) are encrypted with AES-256-GCM before storage. The encryption key is held in your OS keyring.",
    storage_detail_3: "Execution logs are written as plaintext files to your app data directory.",
    storage_detail_4: "No data is sent to Personas servers unless you explicitly use the optional cloud deployment feature.",

    // Section 3: Third-Party Service Connections
    services_title: "Third-Party Service Connections",
    services_tldr: "Agents can connect to services like Slack or GitHub using credentials you provide.",
    services_detail_1: "Personas can make authenticated API calls to 40+ services (Slack, GitHub, Linear, Discord, Jira, Notion, databases, etc.) using credentials you provide.",
    services_detail_2: "These calls are made on your behalf using your credentials. You control which services each persona can access.",
    services_detail_3: "An API proxy validates URLs against a blocklist (private IPs, localhost) to mitigate SSRF risks.",
    services_detail_4: "All external communication uses HTTPS (TLS 1.2+).",

    // Section 4: System Monitoring Capabilities
    monitoring_title: "System Monitoring Capabilities",
    monitoring_tldr: "Agents can watch your clipboard, files, or schedule to trigger actions automatically.",
    monitoring_clipboard: "Clipboard Monitor: When enabled for a persona, the app polls your system clipboard (~500ms interval) to detect text changes matching configured regex patterns. Clipboard content is hashed for change detection and is not stored unless it triggers an execution.",
    monitoring_file: "File Watcher: When configured, monitors specified local directories for file creation or modification to trigger persona execution.",
    monitoring_cron: "Cron Scheduler: Runs personas on configured schedules (cron expressions). Active only while the app is running.",
    monitoring_webhook: "Webhook Server: A local HTTP server (localhost:9420) listens for inbound webhooks when webhook triggers are configured.",

    // Section 5: Local Network Sharing (P2P)
    p2p_title: "Local Network Sharing (P2P)",
    p2p_tldr: "The app can discover and communicate with other Personas instances on your local network.",
    p2p_detail_1: "When enabled, the app broadcasts its presence on your local network via mDNS (_personas._tcp.local.) so other Personas Desktop instances can discover it.",
    p2p_detail_2: "A QUIC transport binds on all network interfaces (0.0.0.0) to accept connections from LAN peers. Only peers with trusted cryptographic identities can exchange data.",
    p2p_detail_3: "Connected peers can exchange persona manifests (names, descriptions, tool lists) and agent-to-agent messages. Credential values are never shared over P2P.",
    p2p_detail_4: "Share links serve persona bundles over HTTP on your local network. These links are only accessible to devices on the same network.",

    // Section 6: Credential & Filesystem Scanning
    foraging_title: "Credential & Filesystem Scanning",
    foraging_tldr: "The app can scan your filesystem to discover existing credentials and read third-party app data.",
    foraging_detail_1: "The Credential Discovery feature scans known paths on your filesystem (e.g., ~/.aws/credentials, ~/.ssh/) to detect existing API keys and tokens you may want to import.",
    foraging_detail_2: "Discovered credential files are read only when you explicitly trigger a scan. Found credentials are shown for review before any import.",
    foraging_detail_3: "Obsidian Brain integration reads Obsidian vault configuration and note files from known OS paths when you enable the feature.",
    foraging_detail_4: "No filesystem data is transmitted externally. All scanned data remains local unless you explicitly import it into the app.",

    // Section 7: Process Execution
    process_title: "Process Execution",
    process_tldr: "The app runs AI tools and scripts on your machine to carry out agent tasks.",
    process_detail_1: "The app spawns AI provider CLI processes (e.g., claude, codex, gemini) as child processes on your machine.",
    process_detail_2: "Credentials are passed to child processes as environment variables (not CLI arguments) and scrubbed after execution.",
    process_detail_3: "Browser automation (Auto-Credential setup) may launch a Playwright-controlled browser session to help set up OAuth credentials. This requires your explicit consent each time.",
    process_detail_4: "Automations can trigger external workflows (GitHub Actions, GitLab CI/CD, n8n, webhooks) based on execution output.",

    // Section 8: Error Reporting & Telemetry
    telemetry_title: "Error Reporting & Telemetry",
    telemetry_tldr: "Anonymous crash reports and usage data help fix bugs -- you can opt out at any time.",
    telemetry_detail_1: "Crash reports may be sent to Sentry for error tracking. IP addresses, email addresses, and request bodies are stripped before transmission.",
    telemetry_detail_2: "Anonymous feature usage data (which sections and tabs you visit) is sent to Sentry to help prioritize development. Anonymous device IDs are used for session counting.",
    telemetry_detail_3: "No personal data, credential values, or execution content is included in any telemetry.",
    telemetry_detail_4: "You can disable all telemetry at any time in Settings > Account. The app checks for updates via GitHub Releases.",

    // Section 9: Deployment (Optional)
    deploy_title: "Deployment (Optional)",
    deploy_tldr: "You can optionally run agents in the cloud -- nothing is uploaded unless you choose to.",
    deploy_detail_1: "You may optionally deploy personas to a cloud orchestrator, GitHub Actions, or GitLab CI/CD. This sends persona configuration (not credentials) to the selected platform.",
    deploy_detail_2: "Cloud deployment uses OAuth authentication with a deep-link callback (personas:// protocol).",
    deploy_detail_3: "Deployed personas run on the target platform under that platform's terms and security model.",

    // Important notices
    important: "Important:",
    notice_responsibility: "You are responsible for the content of your persona prompts and the actions they take on connected services.",
    notice_accuracy: "AI outputs may be inaccurate, biased, or harmful. Always review execution results before acting on them.",
    notice_credentials: "Credentials you store grant the app access to your accounts on third-party services. Use scoped tokens with minimal permissions where possible.",
    notice_license: "This software is provided under the MIT License, without warranty of any kind.",

    // Consent checkboxes and button
    checkbox: "I understand that this application sends data to AI providers, accesses system resources (clipboard, file system, local network), and executes processes on my behalf. I accept responsibility for how I configure and use it.",
    checkbox_telemetry: "Help improve Personas by sending anonymous crash reports and usage analytics. No personal data is included. You can change this later in Settings.",
    source_link: "View source & license",
    accept_button: "I Understand, Continue",
  },

  // -------------------------------------------------------------------
  //  RECIPES -- reusable LLM recipes
  // -------------------------------------------------------------------
  recipes: {
    no_match: "No matching recipes",
    empty: "No recipes yet",
    no_match_hint: "Try a different search term.",
    empty_hint: "Create your first reusable LLM recipe to get started.",
  },

  // -------------------------------------------------------------------
  //  EXECUTION STATUSES -- used in execution lists, badges, filters
  //  These should be short labels (1-2 words).
  // -------------------------------------------------------------------
  execution_status: {
    queued: "Queued",
    running: "Running",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
    error: "Error",
  },

  // -------------------------------------------------------------------
  //  STATUS TOKENS -- machine tokens from the Rust backend mapped to
  //  human-readable labels. Used by tokenLabel() in tokenMaps.ts.
  //  Keep values short (1-2 words) for badges and status pills.
  // -------------------------------------------------------------------
  status_tokens: {
    // Execution status (mirrors execution_status above for token-based access)
    execution: {
      queued: "Queued",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      cancelled: "Cancelled",
      error: "Error",
    },
    // Event processing status
    event: {
      pending: "Pending",
      processing: "Processing",
      processed: "Processed",
      failed: "Failed",
      retrying: "Retrying",
    },
    // Automation run status
    automation: {
      pending: "Pending",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      timeout: "Timed Out",
    },
    // Severity levels (healing issues, alerts, errors)
    severity: {
      info: "Info",
      low: "Low",
      medium: "Medium",
      high: "High",
      critical: "Critical",
    },
    // Message / task priority
    priority: {
      low: "Low",
      normal: "Normal",
      high: "High",
      urgent: "Urgent",
    },
    // Healing issue status
    healing_status: {
      open: "Open",
      auto_fixed: "Auto-Fixed",
      acknowledged: "Acknowledged",
      resolved: "Resolved",
    },
    // Healing issue category
    healing_category: {
      config: "Configuration",
      auth: "Authentication",
      network: "Network",
      timeout: "Timeout",
      quota: "Quota",
    },
    // Credential connector status
    connector_status: {
      ready: "Ready",
      untested: "Untested",
      failed: "Failed",
      no_credential: "No Credential",
      testing: "Testing",
    },
    // Test run status
    test: {
      generating: "Generating",
      running: "Running",
      completed: "Completed",
      failed: "Failed",
      pending: "Pending",
    },
    // Dev goal / task status
    dev: {
      open: "Open",
      in_progress: "In Progress",
      completed: "Completed",
      blocked: "Blocked",
      queued: "Queued",
      running: "Running",
      failed: "Failed",
    },
  },
  // ==========================================================================
  // Project Overview — Dev Tools Overview tab
  // ==========================================================================
  project_overview: {
    // Section headers — displayed as column titles
    codebase: "Codebase",
    monitoring: "Monitoring",

    // Connection states
    connected: "Connected",
    not_connected: "Not connected",
    // Prompt to add a credential to the vault (GitHub, GitLab, Sentry)
    connect_to_see_stats: "Connect {{service}} to see {{category}} stats",
    go_to_connections: "Go to Connections",
    // Prompt when credential exists but not mapped to this project
    credential_found: "{{service}} credential found",
    set_repo_url: "Set a repository URL on your project to see stats.",
    go_to_projects: "Go to Projects",
    link_monitoring: "Link it to this project to see error tracking stats.",
    link_to_project: "Link to Project",
    // Monitoring link form
    project_slug: "Project slug",
    project_slug_placeholder: "my-project",
    save: "Save",

    // Stat labels — displayed under each stat number
    open_issues: "Open issues",
    open_prs: "Open PRs",
    open_mrs: "Open MRs",
    commits_this_week: "Commits this week",
    default_branch: "Default branch",
    last_push: "Last push",
    unresolved_issues: "Unresolved issues",
    events_24h: "Events (24h)",
    events_7d: "Events (7d)",

    // Loading & error
    loading_stats: "Loading stats...",
    failed_to_load: "Failed to load stats",
    retry: "Retry",
    no_project_selected: "No project selected",
    select_project_hint: "Select a dev project to see its overview.",
  },

  // ==========================================================================
  // Media Studio — Artist plugin video composition tab
  // ==========================================================================
  media_studio: {
    // Tab and header
    title: "Media Studio",
    subtitle: "Compose videos with text, images, and audio layers",

    // FFmpeg detection
    ffmpeg_not_found: "FFmpeg not found",
    ffmpeg_not_found_hint: "FFmpeg is required to export videos. Install it and restart the app.",
    ffmpeg_install_windows: "Windows: winget install ffmpeg (or download from ffmpeg.org)",
    ffmpeg_install_mac: "macOS: brew install ffmpeg",
    ffmpeg_install_linux: "Linux: sudo apt install ffmpeg",
    ffmpeg_found: "FFmpeg ready",
    check_again: "Check again",

    // Layers
    layer_text: "Text",
    layer_image: "Images",
    layer_video: "Video",
    layer_audio: "Audio",

    // Timeline
    add_text_beat: "Add beat",
    add_image: "Add image",
    add_video: "Add video",
    add_audio: "Add audio",
    empty_lane: "Drop or click + to add",
    zoom_in: "Zoom in",
    zoom_out: "Zoom out",
    fit_to_view: "Fit to view",

    // Beats/items
    beat_word: "Beat word",
    beat_description: "Description",
    beat_word_placeholder: "Word",
    beat_description_placeholder: "Describe this beat...",

    // Inspector
    inspector_title: "Properties",
    no_selection: "Select an item on the timeline to edit its properties.",
    start_time: "Start",
    duration: "Duration",
    trim_start: "Trim start",
    trim_end: "Trim end",
    volume: "Volume",
    font_size: "Font size",
    color: "Color",
    position: "Position",
    scale: "Scale",
    transition: "Transition",
    transition_cut: "Cut",
    transition_crossfade: "Crossfade",
    transition_fade_to_black: "Fade to black",
    transition_duration: "Transition duration",

    // Playback
    play: "Play",
    pause: "Pause",
    stop: "Stop",
    loop: "Loop",
    current_time: "Current time",

    // Export
    export_title: "Export",
    export_button: "Export to MP4",
    exporting: "Exporting...",
    export_complete: "Export complete",
    export_failed: "Export failed",
    export_cancel: "Cancel export",
    output_settings: "Output settings",
    resolution: "Resolution",
    framerate: "Frame rate",
    choose_output: "Choose output file",

    // Empty state
    empty_title: "Start composing",
    empty_hint: "Add video or audio clips to the timeline to begin.",

    // Context menu
    split: "Split at playhead",

    // File import
    import_media: "Import media",
    supported_video: "Video files",
    supported_audio: "Audio files",
    supported_images: "Image files",
  },

  // =========================================================================
  // Research Lab plugin
  // =========================================================================
  research_lab: {
    // Tab labels
    dashboard: "Dashboard",
    projects: "Projects",
    literature: "Literature",
    hypotheses: "Hypotheses",
    experiments: "Experiments",
    findings: "Findings",
    reports: "Reports",

    // Dashboard
    active: "active",
    sources: "Sources",
    sources_count: "sources",

    // Project list
    no_projects: "No research projects yet",
    no_projects_hint: "Create a research project to start organizing your literature, hypotheses, and experiments.",
    create_project: "New Project",

    // Project form
    project_name: "Project name",
    project_description: "Description",
    project_thesis: "Research question or thesis",
    project_domain: "Domain",
    project_scope: "Scope constraints",

    // Project status tokens
    status_scoping: "Scoping",
    status_literature_review: "Literature review",
    status_hypothesis: "Hypothesis",
    status_experiment: "Experiment",
    status_analysis: "Analysis",
    status_writing: "Writing",
    status_review: "Review",
    status_complete: "Complete",

    // Literature
    select_project_first: "Select a research project first",
    no_sources: "No sources yet",
    no_sources_hint: "Search arXiv, Semantic Scholar, or PubMed to find relevant papers, or add sources manually.",
    relevance: "Relevance",
    search_sources: "Search sources",
    ingest: "Ingest",
    ingesting: "Ingesting...",

    // Hypotheses
    no_hypotheses: "No hypotheses yet",
    no_hypotheses_hint: "Add hypotheses manually or let an AI agent generate them from your literature corpus.",
    add_hypothesis: "Add hypothesis",
    generate_hypotheses: "Generate hypotheses",
    confidence: "Confidence",
    supporting: "Supporting",
    counter: "Counter",

    // Experiments
    no_experiments: "No experiments yet",
    no_experiments_hint: "Design an experiment to test a hypothesis.",
    create_experiment: "New experiment",
    methodology: "Methodology",
    success_criteria: "Success criteria",
    run_experiment: "Run",
    run_count: "runs",

    // Findings
    no_findings: "No findings yet",
    no_findings_hint: "Findings are extracted from experiment results by analysis agents.",

    // Reports
    no_reports: "No reports yet",
    no_reports_hint: "Create a report to compile your findings into a structured document.",
    create_report: "New report",
    report_type: "Report type",
    literature_review: "Literature review",
    experiment_report: "Experiment report",
    full_paper: "Full paper",
    executive_summary: "Executive summary",
  },

  // ---------------------------------------------------------------------------
  // Event type taxonomy labels
  // ---------------------------------------------------------------------------
  event_types: {
    // ── Trigger events ─────────────────────────────────────────────────────
    webhook_received_label: "Webhook Received",
    webhook_received_description: "Fires when an external webhook POST arrives",
    schedule_fired_label: "Schedule Fired",
    schedule_fired_description: "Fires when a cron or interval trigger executes",
    polling_changed_label: "Polling Changed",
    polling_changed_description: "Fires when a polled endpoint returns new content",
    file_changed_label: "File Changed",
    file_changed_description: "Fires when a watched file or directory changes",
    clipboard_changed_label: "Clipboard Changed",
    clipboard_changed_description: "Fires when clipboard content changes",
    app_focus_changed_label: "App Focus Changed",
    app_focus_changed_description: "Fires when the foreground application changes",
    chain_completed_label: "Chain Completed",
    chain_completed_description: "Fires when a chained persona finishes execution",
    composite_fired_label: "Composite Fired",
    composite_fired_description: "Fires when a multi-condition composite trigger matches",
    trigger_fired_label: "Trigger Fired",
    trigger_fired_description: "Generic event emitted when any trigger activates",
    schedule_triggered_label: "Schedule Triggered",
    schedule_triggered_description: "Alias for schedule_fired — emitted by legacy schedule triggers",

    // ── Execution events ───────────────────────────────────────────────────
    execution_completed_label: "Execution Completed",
    execution_completed_description: "Fires when any persona execution completes successfully",
    execution_failed_label: "Execution Failed",
    execution_failed_description: "Fires when a persona execution fails",

    // ── System / persona events ────────────────────────────────────────────
    persona_action_label: "Persona Action",
    persona_action_description: "Fires when a persona emits a custom action during execution",
    emit_event_label: "Custom Emit",
    emit_event_description: "Fires when a persona emits a custom event via EmitEvent protocol",
    credential_rotated_label: "Credential Rotated",
    credential_rotated_description: "Fires when a credential is rotated in the vault",
    credential_event_label: "Credential Event",
    credential_event_description: "General credential lifecycle event (provisioned, revoked, etc.)",
    credential_provisioned_label: "Credential Provisioned",
    credential_provisioned_description: "Fires when a new credential is provisioned and ready for use",
    memory_created_label: "Memory Created",
    memory_created_description: "Fires when a new memory entry is created",
    task_created_label: "Task Created",
    task_created_description: "Fires when a new task is created for a persona",

    // ── Lifecycle / deployment events ──────────────────────────────────────
    health_check_failed_label: "Health Check Failed",
    health_check_failed_description: "Fires when a persona health check fails",
    deployment_started_label: "Deployment Started",
    deployment_started_description: "Fires when a cloud deployment begins",
    deploy_started_label: "Deploy Started",
    deploy_started_description: "Fires when a deployment process starts",
    deploy_succeeded_label: "Deploy Succeeded",
    deploy_succeeded_description: "Fires when a deployment completes successfully",
    deploy_failed_label: "Deploy Failed",
    deploy_failed_description: "Fires when a deployment fails",
    agent_undeployed_label: "Agent Undeployed",
    agent_undeployed_description: "Fires when an agent is removed from cloud deployment",
    review_submitted_label: "Review Submitted",
    review_submitted_description: "Fires when a design or manual review is submitted",

    // ── Test / development ─────────────────────────────────────────────────
    test_event_label: "Test Event",
    test_event_description: "Fires during test flows and dry-run executions",
    custom_label: "Custom",
    custom_description: "User-defined event type for ad-hoc integrations",

    // ── Category labels ────────────────────────────────────────────────────
    category_trigger_label: "Trigger Events",
    category_trigger_description: "Events emitted by trigger sources (webhooks, schedules, file watchers, etc.)",
    category_execution_label: "Execution Events",
    category_execution_description: "Events related to persona execution lifecycle",
    category_system_label: "System Events",
    category_system_description: "Events from internal systems (vault, memory, custom persona actions)",
    category_lifecycle_label: "Lifecycle Events",
    category_lifecycle_description: "Events related to deployment, health checks, and reviews",
    category_test_label: "Test Events",
    category_test_description: "Events used during testing and dry-run flows",

    // ── Source filter help ─────────────────────────────────────────────────
    source_filter_title: "Source Filter Matching",
    source_filter_exact_match: 'Exact match — only events with source_id "webhook-1"',
    source_filter_prefix_wildcard: 'Prefix wildcard — any source_id starting with "watcher-"',
    source_filter_no_regex: "Only trailing * is supported (no regex, no ? wildcards)",
    source_filter_no_source_id: "If source_filter is set but the event has no source_id, the filter will not match",
    source_filter_allowed_chars: "Allowed characters: letters, numbers, _, -, :, ., and *",
    source_filter_max_length: "Maximum 120 characters, maximum 3 wildcard characters",
  },

  // ---------------------------------------------------------------------------
  // Connector roles — functional role labels for connector interchangeability
  // ---------------------------------------------------------------------------
  connector_roles: {
    // Role labels
    chat_messaging: "Chat & Messaging",
    email_delivery: "Email Delivery",
    sms: "SMS",
    source_control: "Source Control",
    ci_cd: "CI/CD",
    project_tracking: "Project Tracking",
    knowledge_base: "Knowledge Base",
    design: "Design",
    feature_flags: "Feature Flags",
    hosting: "Hosting & Deploy",
    cloud_infra: "Cloud Infrastructure",
    database: "Database",
    cloud_storage: "Cloud Storage",
    error_monitoring: "Error Monitoring",
    incident_management: "Incident Management",
    uptime_monitoring: "Uptime Monitoring",
    security_scanning: "Security Scanning",
    analytics: "Product Analytics",
    spreadsheet: "Spreadsheets",
    crm: "CRM",
    support_ticketing: "Support Ticketing",
    social_media: "Social Media",
    cms: "CMS",
    search_engine: "Search Engine",
    video_comms: "Video & Comms",
    payment_processing: "Payment Processing",
    accounting: "Accounting",
    banking_fintech: "Banking & Fintech",
    market_data: "Market Data",
    e_commerce: "E-Commerce",
    scheduling: "Scheduling",
    form_survey: "Forms & Surveys",
    notifications: "Notifications",
    auth_identity: "Auth & Identity",
    ai_platform: "AI Platform",
    advertising: "Advertising",
    e_signature: "E-Signature",
    hr_recruiting: "HR & Recruiting",
    tool_gateway: "Tool Gateway",
    code_editor: "Code Editor",
    container_runtime: "Container Runtime",
    shell: "Shell / Terminal",
    note_taking: "Note Taking",
    browser_automation: "Browser Automation",

    // Purpose group labels
    purpose_messaging: "Messaging",
    purpose_email: "Email / SMS",
    purpose_notifications: "Notifications",
    purpose_devops: "DevOps / CI-CD",
    purpose_project_mgmt: "Project Mgmt",
    purpose_productivity: "Productivity",
    purpose_design: "Design",
    purpose_cloud: "Cloud",
    purpose_database: "Database",
    purpose_storage: "Storage",
    purpose_monitoring: "Monitoring",
    purpose_analytics: "Analytics",
    purpose_crm: "CRM",
    purpose_support: "Support",
    purpose_social: "Social",
    purpose_cms: "CMS",
    purpose_finance: "Finance",
    purpose_ecommerce: "E-Commerce",
    purpose_scheduling: "Scheduling",
    purpose_forms: "Forms",
    purpose_ai: "AI",
  },

  // ---------------------------------------------------------------------------
  // Connector licensing — license tier labels
  // ---------------------------------------------------------------------------
  connector_licensing: {
    personal: "Personal",
    paid: "Paid",
    enterprise: "Enterprise",
  },

  // -------------------------------------------------------------------
  //  ALERTS -- alert metric & severity labels (alertSlice.ts)
  // -------------------------------------------------------------------
  alerts: {
    // Alert metric option labels
    metric_error_rate: "Error Rate",
    metric_success_rate: "Success Rate",
    metric_cost: "Total Cost",
    metric_cost_spike: "Cost vs. Average",
    metric_executions: "Executions",

    // Alert severity labels
    severity_info: "Info",
    severity_warning: "Warning",
    severity_critical: "Critical",

    // Toast error prefixes
    error_create_rule: "Failed to create alert rule:",
    error_update_rule: "Failed to update alert rule:",
    error_delete_rule: "Failed to delete alert rule:",
    error_toggle_rule: "Failed to toggle alert rule:",
    error_dismiss: "Failed to dismiss alert:",
    error_clear_history: "Failed to clear alert history:",
  },

  // -------------------------------------------------------------------
  //  DEPLOY ERRORS -- user-facing error messages (deployTarget.ts)
  // -------------------------------------------------------------------
  deploy_errors: {
    // Shared connection / network errors
    not_reachable: "Could not reach the server. Check the URL and your network connection.",
    timed_out: "Connection timed out. The server may be down or the URL may be incorrect.",
    dns_resolve: "Could not resolve the hostname. Double-check the URL for typos.",
    unauthorized: "Invalid credentials. Please verify and try again.",
    forbidden: "Access denied. Your credentials may not have the required permissions.",
    internal_server_error: "The server returned an internal error. Try again in a few minutes.",
    service_unavailable: "The server is temporarily unavailable. Try again shortly.",
    not_connected: "Not connected. Please connect first.",
    keyring: "Could not access stored credentials. You may need to reconnect.",

    // Cloud-specific
    oauth_expired: "OAuth token has expired. Please re-authorize.",
    url_empty: "Please enter the orchestrator URL.",
    api_key_empty: "Please enter your API key.",

    // GitLab-specific
    token_empty: "Please enter your GitLab personal access token.",
  },

  // -------------------------------------------------------------------
  //  UI TIERS -- tier display labels (uiModes.ts)
  // -------------------------------------------------------------------
  tiers: {
    starter_label: "Simple",
    starter_desc: "Core features for everyday use",
    team_label: "Power",
    team_desc: "Full feature set",
  },

  // -------------------------------------------------------------------
  //  TRIGGERS -- trigger type & category labels (triggerConstants.ts)
  // -------------------------------------------------------------------
  triggers: {
    // Trigger type labels
    type_manual: "Manual",
    type_schedule: "Schedule",
    type_polling: "Polling",
    type_webhook: "Webhook",
    type_event_listener: "Event Listener",
    type_file_watcher: "File Watcher",
    type_clipboard: "Clipboard",
    type_app_focus: "App Focus",
    type_chain: "Chain",
    type_composite: "Composite",

    // Trigger type descriptions
    desc_manual: "Run on demand",
    desc_schedule: "Run on a timer or cron",
    desc_polling: "Check an endpoint",
    desc_webhook: "HTTP webhook listener",
    desc_event_listener: "React to internal events",
    desc_file_watcher: "React to file system changes",
    desc_clipboard: "React to clipboard changes",
    desc_app_focus: "React to app focus changes",
    desc_chain: "Trigger after another agent completes",
    desc_composite: "Multiple conditions + time window",

    // Trigger category labels
    category_pull: "Watch",
    category_push: "Listen",
    category_compose: "Combine",

    // Trigger category descriptions
    category_pull_desc: "Poll for changes on an interval",
    category_push_desc: "Receive external signals",
    category_compose_desc: "Chain or compose triggers",

    // Rate limit window labels
    rate_per_minute: "Per minute",
    rate_per_5_minutes: "Per 5 minutes",
    rate_per_hour: "Per hour",

    // Trigger template labels
    tpl_fw_error_logs: "Auto-analyze error logs",
    tpl_fw_error_logs_desc: "Triggers when new .log files appear or change in a folder",
    tpl_fw_csv_data: "Process new CSV files",
    tpl_fw_csv_data_desc: "Triggers when CSV files are added or modified",
    tpl_fw_config_changes: "Watch config file changes",
    tpl_fw_config_changes_desc: "Triggers on changes to JSON, YAML, or TOML config files",
    tpl_cb_url_summarize: "Auto-summarize copied URLs",
    tpl_cb_url_summarize_desc: "Triggers when you copy a URL to your clipboard",
    tpl_cb_error_message: "Auto-diagnose error messages",
    tpl_cb_error_message_desc: "Triggers when you copy text containing errors or exceptions",
    tpl_cb_code_snippet: "Auto-format code snippets",
    tpl_cb_code_snippet_desc: "Triggers when you copy code-like text (function definitions, imports)",
  },

  // -------------------------------------------------------------------
  //  MODELS -- model catalog labels (modelCatalog.ts)
  // -------------------------------------------------------------------
  models: {
    haiku: "Haiku",
    sonnet: "Sonnet",
    opus: "Opus",
  },

  // ---------------------------------------------------------------------------
  // Error explanation — user-facing summaries, guidance, and action labels
  // for matched error patterns (errorExplanation.ts)
  // ---------------------------------------------------------------------------
  error_explanation: {
    // Action labels (buttons that navigate to a section)
    action_go_to_vault: "Go to Vault",
    action_check_credentials: "Check Credentials",
    action_edit_triggers: "Edit Triggers",
    action_persona_settings: "Persona Settings",

    // Error summaries (short, one-line description shown in the UI)
    summary_api_key: "API key issue detected.",
    summary_auth_failed: "Authentication failed.",
    summary_credential: "Credential issue.",
    summary_permission_denied: "Permission denied.",
    summary_rate_limit: "Rate limit reached.",
    summary_quota: "Account quota or billing issue.",
    summary_budget: "Budget limit reached.",
    summary_timeout: "The operation timed out.",
    summary_network: "Network connection failed.",
    summary_command_not_found: "Required command not found.",
    summary_cli_missing: "The AI backend (Claude CLI) is not installed.",
    summary_out_of_memory: "Out of memory.",
    summary_server_error: "The remote server encountered an error.",
    summary_decryption: "Decryption failed.",
    summary_webhook: "Webhook delivery issue.",
    summary_import_invalid: "Import file is invalid.",
    summary_circular_chain: "Circular agent chain detected.",
    summary_parse_error: "Failed to parse response data.",
    summary_process_exit: "The process exited with an error.",

    // Error guidance (longer explanation shown below the summary)
    guidance_api_key: "Check that your API key is valid and hasn't expired.",
    guidance_auth_failed: "Your API key may be invalid or expired.",
    guidance_credential: "A required credential may be missing or invalid.",
    guidance_permission_denied: "The tool or API denied access. Verify your credentials have the necessary permissions.",
    guidance_rate_limit: "The API rate limit was hit. Try reducing the trigger frequency.",
    guidance_quota: "Your API account may have reached its spending limit. Check your account billing status.",
    guidance_budget: "This agent has reached its spending limit. Increase the budget in Settings or wait until the next billing cycle.",
    guidance_timeout: "The request took too long. Adjust the timeout in persona settings.",
    guidance_network: "Could not reach the server. Check your internet connection and that the target service is available.",
    guidance_command_not_found: "A system command needed for this execution is not installed. Check that all required CLI tools are available on your system.",
    guidance_cli_missing: "Install the Claude CLI and restart the app.",
    guidance_out_of_memory: "The system ran out of memory. Try closing other applications or reducing the task complexity.",
    guidance_server_error: "The API returned a server error. This is usually temporary -- try again in a few minutes.",
    guidance_decryption: "Could not decrypt — the passphrase may be wrong or the file is corrupted. Double-check your passphrase and try again.",
    guidance_webhook: "Check that the webhook URL is correct and the external service is available.",
    guidance_import_invalid: "The import file is empty or damaged. Try re-exporting from the source and importing again.",
    guidance_circular_chain: "This would create a loop where agents trigger each other endlessly. Review your agent chain and remove the circular reference.",
    guidance_parse_error: "The response was not in the expected format. This may indicate an API change or malformed data.",
    guidance_process_exit: "The underlying process reported a failure. Check the execution log for more details.",
  },

  // ---------------------------------------------------------------------------
  // Process notification labels — human-readable names for background
  // process types (notifyProcessComplete.ts, NotificationCenter.tsx)
  // ---------------------------------------------------------------------------
  process_labels: {
    n8n_transform: "n8n Transform",
    template_adopt: "Template Adoption",
    rebuild: "Agent Rebuild",
    template_test: "Template Test",
    context_scan: "Context Map Scan",
    idea_scan: "Idea Scan",
    execution: "Agent Execution",
    matrix_build: "Matrix Build",
    lab_run: "Lab Run",
    connector_test: "Connector Test",
    creative_session: "Creative Session",

    // Notification title suffixes
    complete_suffix: "Complete",
    failed_suffix: "Failed",

    // Human review notification
    pending_reviews_one: "{count} pending review awaiting approval",
    pending_reviews_other: "{count} pending reviews awaiting approval",
  },

  // ---------------------------------------------------------------------------
  // Eval strategy metadata — labels and descriptions for evaluation
  // strategies used in persona testing (evalFramework.ts)
  // ---------------------------------------------------------------------------
  eval_strategies: {
    keyword_match_label: "Output Quality",
    keyword_match_description: "Checks expected behavior terms in agent output",
    tool_accuracy_label: "Tool Accuracy",
    tool_accuracy_description: "Compares expected vs actual tool calls",
    protocol_compliance_label: "Protocol Compliance",
    protocol_compliance_description: "Checks for expected protocol message patterns",
    confusion_detect_label: "Confusion Detection",
    confusion_detect_description: "Checks for known confusion/failure phrases",
    composite_label: "Composite",
    composite_description: "Weighted combination of all strategies",
  },

  // ---------------------------------------------------------------------------
  // Design drift — labels for drift event kinds and generated event
  // titles/descriptions/suggestions (designDrift.ts)
  // ---------------------------------------------------------------------------
  drift_labels: {
    // Drift kind labels (badges)
    kind_error_pattern: "Error Pattern",
    kind_tool_mismatch: "Tool Issue",
    kind_timeout: "Timeout Risk",
    kind_cost_overrun: "Cost Alert",
    kind_repeated_failure: "Repeated Failure",

    // Drift event titles
    title_tool_call_failure: "Tool call failure detected",
    title_execution_timeout: "Execution timeout detected",
    title_api_error: "API error pattern detected",
    title_execution_failure: "Execution failure detected",
    title_near_timeout: "Near-timeout execution",
    title_high_cost: "High execution cost",
    title_repeated_failures: "Repeated failures ({count} consecutive)",

    // Drift event descriptions
    desc_tool_error: "Execution failed with tool error: \"{message}\"",
    desc_timeout: "Agent timed out: \"{message}\"",
    desc_api_error: "API-related failure ({category}): \"{message}\"",
    desc_generic_failure: "Failed with: \"{message}\"",
    desc_near_timeout: "Execution took {seconds}s ({percent}% of timeout).",
    desc_high_cost: "Single execution cost ${cost} ({percent}% of budget).",
    desc_repeated_failure: "This agent has failed multiple times in a row. The design may need significant revision.",

    // Drift event suggestions
    suggestion_tool_guidance: "Update toolGuidance to add error recovery instructions or remove the failing tool.",
    suggestion_timeout: "Increase timeout_ms or simplify instructions to reduce processing time.",
    suggestion_rate_limit: "Add rate limiting guidance or retry instructions to errorHandling section.",
    suggestion_error_handling: "Review errorHandling section and add handling for this failure pattern.",
    suggestion_near_timeout: "Consider increasing timeout or simplifying the agent's task scope in instructions.",
    suggestion_high_cost: "Tighten instructions to reduce token usage, or consider using a smaller model.",
    suggestion_repeated_failure: "Consider running a new design analysis to rebuild the agent configuration.",
  },

  // ---------------------------------------------------------------------------
  // Template feedback — label text for feedback tags applied to
  // template design reviews (templateFeedback.ts)
  // ---------------------------------------------------------------------------
  feedback_labels: {
    accurate_prompt: "Accurate Prompt",
    good_tool_selection: "Good Tool Selection",
    reliable: "Reliable",
    cost_efficient: "Cost Efficient",
    wrong_tools: "Wrong Tools",
    poor_instructions: "Poor Instructions",
    missing_context: "Missing Context",
    over_engineered: "Over-Engineered",
    under_specified: "Under-Specified",
    wrong_triggers: "Wrong Triggers",
    credential_issues: "Credential Issues",
  },

  // ---------------------------------------------------------------------------
  // Protocol labels — human-readable names for protocol capabilities
  // detected during workflow import (platformDefinitions.ts)
  // ---------------------------------------------------------------------------
  protocol_labels: {
    manual_review: "Manual Review",
    user_message: "User Notifications",
    agent_memory: "Agent Memory",
    emit_event: "Event Emission",
  },
};

export type Translations = typeof en;
