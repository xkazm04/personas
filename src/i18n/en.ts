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
    confirm: "Confirm",
    done: "Done",
    swap: "Swap",
    draft: "Draft",
    tools: "Tools",
    triggers: "Triggers",
    connectors: "Connectors",
    add: "Add",
    test: "Test",

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

    // -- Shared feedback strings (ErrorBanner, InlineErrorBanner, etc.) --
    // Button text shown on error panels alongside a back-arrow icon
    go_back: "Go back",
    // Accessible label for the dismiss button (close icon) on banners
    dismiss_notification: "Dismiss notification",
    // Shown next to a spinner while reconnecting to real-time services
    connecting: "Connecting...",
    // Label for a successfully connected real-time channel
    connected: "Connected",
    // Label for a disconnected real-time channel
    disconnected: "Disconnected",
    // Shown while a reconnection attempt is in progress; {seconds} = countdown
    reconnecting: "Reconnecting",
    // Title for reconnection tooltip; {attempt} = attempt number, {seconds} = seconds
    reconnect_attempt: "Reconnection attempt {attempt} -- retrying in {seconds}s",

    // -- ErrorBoundary recovery UI --
    // Title when a component crashes (with name); {name} = component name
    error_boundary_title_named: "Something unexpected happened in {name}",
    // Title when a component crashes (no name available)
    error_boundary_title: "Something unexpected happened",
    // Reassuring subtitle shown below the crash title
    error_boundary_subtitle: "Don't worry -- your data is safe. You can try again or head back to the dashboard.",
    // Button: attempt to recover the crashed component
    try_again: "Try Again",
    // Button: navigate back to the main dashboard
    go_to_dashboard: "Go to Dashboard",
    // Button: copy the crash report for support
    copy_report: "Copy report for support",
    // Shown after the crash report is copied
    copied_to_clipboard: "Copied to clipboard",
    // Label for collapsible developer-only crash details
    for_developers: "For developers",
    // Fallback when no stack trace is available
    no_stack_trace: "No stack trace available",

    // -- Toast/notification strings --
    // Healing-toast action: mark an issue as resolved
    resolve: "Resolve",
    // Toast overflow indicator; {count} = number of hidden toasts
    toast_overflow: "+{count} more",

    // -- Unsaved-changes modal --
    // Modal title asking to save before navigating away
    unsaved_title: "Save changes before leaving?",
    // Body text when specific sections have changes; {sections} = comma-separated list
    unsaved_body_sections: "You have unsaved changes in {sections}. These will be lost if you leave without saving.",
    // Body text when no specific sections are identified
    unsaved_body: "You have unsaved changes that will be lost if you leave without saving.",
    // Button: save and proceed with navigation
    save_and_continue: "Save and continue",
    // Button: discard changes and proceed
    discard_changes: "Discard changes",
    // Button: stay on the current page
    stay_on_page: "Stay on page",

    // -- ConfirmDestructiveModal --
    // Instruction above the type-to-confirm input; {name} = text to type
    type_to_confirm: "Type {name} to confirm",

    // -- QuickEditPanel --
    // Label shown in the quick-edit inline panel header
    quick_edit: "Quick Edit",
    // Form field labels
    description_label: "Description",
    model_label: "Model",
    // Placeholder for the agent description textarea
    agent_description_placeholder: "Agent description...",

    // -- KeyValueEditor --
    // Toggle button to switch to simple key-value mode
    simple_mode: "Simple mode",
    // Toggle button to switch to advanced JSON editing mode
    advanced_json: "Advanced (JSON)",
    // Placeholder for the key/label column in key-value editor
    label_placeholder: "Label",
    // Placeholder for the value column in key-value editor
    value_placeholder: "Value",
    // Warning shown when a key-value row has a duplicate key
    duplicate_key: "Duplicate key",
    // Button: add a new key-value row
    add_field: "Add field",

    // -- DirectoryPickerInput --
    // Default placeholder for the directory picker input
    select_directory: "Select a directory...",
    // Title for the native directory picker dialog
    select_output_directory: "Select output directory",
    // Button: open the native directory browser
    browse: "Browse",

    // -- PersonaSelector --
    // Default placeholder text for the persona selector trigger
    select_persona: "Select persona",
    // "All" option label in persona selector dropdowns
    all_personas: "All Personas",
    // Search input placeholder inside the persona selector
    search_ellipsis: "Search...",
    // Shown when no personas match the search query; {query} = search text
    no_personas_matching: "No personas matching \"{query}\"",

    // -- AccessibleToggle sr-only labels --
    // Screen-reader label when a toggle is in the ON state (already have enabled/disabled above)

    // -- DesignInput --
    // Drag-and-drop overlay label
    drop_file_here: "Drop file here",
    // Button: attach a file to the design input
    attach: "Attach",
    // Button: toggle the references URL section
    references: "References",
    // File count indicator; {count} = number of attached files
    files_attached_one: "{count} file attached",
    files_attached_other: "{count} files attached",
    // Help text below the design input textarea
    press_enter_to_submit: "Press Enter to submit, Shift+Enter for new line.",

    // -- StalenessIndicator --
    // Age label: less than 1 minute old
    staleness_just_now: "just now",
    // Age label with minutes; {minutes} = number of minutes
    staleness_minutes_ago: "{minutes}m ago",
    // Age label with hours; {hours} = number of hours
    staleness_hours_ago: "{hours}h ago",
    // Age label with days; {days} = number of days
    staleness_days_ago: "{days}d ago",
    // Tooltip showing stale data with label; {label} = section, {age} = formatted age
    staleness_tooltip_labeled: "{label} data last updated {age}",
    // Tooltip showing stale data without label; {age} = formatted age
    staleness_tooltip: "Data last updated {age}",
    // Suffix appended when refresh failed
    staleness_refresh_failed: "(refresh failed)",

    // -- CommandPalette --
    // Search input placeholder for the command palette
    command_palette_placeholder: "Search agents, credentials, templates... (type \">\" for commands)",
    // Keyboard hint labels
    command_palette_navigate: "navigate",
    command_palette_select: "select",
    command_palette_commands: "commands",

    // -- SuspenseFallback --
    // Default label for the suspense loading spinner (accessible)
    loading_label: "Loading",
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
      plugins: {
        label: "Plugins",
        description: "Extend your agents with third-party plugins and custom extensions",
      },
    },
    // -- HomeLearning --
    learning: {
      title: "Learning Center",
      subtitle: "Guided tours and quick tricks to master Personas",
      guided_tours: "Guided Tours",
      // {completed}/{total}
      tours_completed: "{completed}/{total} completed",
      done: "Done",
      restart: "Restart",
      start_tour: "Start Tour",
      // {count} steps
      steps_count: "{count} steps",
      tricks_tips: "Tricks & Tips",
      // {count} guides
      guides_count: "{count} guides",
      how_to_use: "How to use",
      pro_tip: "Pro tip: ",
      // Category labels
      cat_agent_craft: "Agent Craft",
      cat_observability: "Observability & Events",
      cat_platform: "Platform & Setup",
    },
    // -- SetupCards --
    setup_stepper: {
      your_profile: "Your profile",
      choose_role: "Choose your role",
      tailor_hint: "We'll tailor the experience to match how you work.",
      simple_hint: "We've set up the app for everyday office use.",
      pick_tool: "Pick your favorite tool",
      tool_hint: "This will be your first connector integration.",
      automate_title: "What do you want to automate?",
      automate_hint: "Describe your first automation goal -- we'll help you set it up.",
      automate_placeholder: "e.g. Automatically sync new Jira tickets to a Slack channel...",
      // {current}/{min}
      min_chars: "Min 10 characters ({current}/10)",
      ready_to_save: "Ready to save",
      back: "Back",
      next: "Next",
      finish: "Finish",
    },
    // -- WelcomeLayout --
    welcome_layout: {
      get_started: "Get Started",
      language: "Language",
    },
    // -- IconShowcase --
    icon_showcase: {
      lucide_tab: "Lucide (Library)",
      personas_tab: "Personas (Animated)",
      lucide_footer: "lucide-react -- generic icon library -- static",
      personas_footer: "9 custom icons -- neural/circuit motifs -- CSS-animated -- theme-adaptive",
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
      // {label} = column header label
      filter_by: "Filter by {label}",
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

    // -----------------------------------------------------------------
    //  EXECUTIONS -- execution list, detail, runner, replay, inspector
    // -----------------------------------------------------------------
    executions: {
      // ExecutionList -- no persona selected / loading / empty state
      no_persona_selected: "No persona selected",
      loading_executions: "Loading executions",
      agent_ready: "Your agent is ready to go",
      agent_ready_subtitle: "Run it to see results here. Each execution will appear in this timeline.",
      try_it_now: "Try it now",

      // ExecutionListHeader -- table column headers & controls
      history: "History",
      sensitive_visible: "Sensitive values are visible",
      sensitive_masked: "Sensitive values are masked",
      raw: "Raw",
      masked: "Masked",
      compare: "Compare",
      // Compare mode toolbar
      select_first: "Select the first execution to compare",
      select_second: "Now select the second execution",
      ready_to_compare: "Ready to compare",
      vs: "vs",

      // Table column headers
      col_status: "Status",
      col_duration: "Duration",
      col_started: "Started",
      col_tokens: "Tokens",
      col_cost: "Cost",

      // ExecutionRow -- tooltips
      input_tokens: "Input tokens",
      output_tokens: "Output tokens",
      // {count} = retry count
      healing_retry: "Healing retry #{count}",

      // ExecutionExpandedDetail -- field labels
      execution_id: "Execution ID",
      model: "Model",
      model_default: "default",
      cost: "Cost",
      completed: "Completed",
      input_data: "Input Data",
      output_data: "Output Data",
      error: "Error",
      rerun_with_same_input: "Re-run with same input",
      compare_with_original: "Compare with original",

      // ExecutionLogViewer -- collapsible log
      execution_log: "Execution Log",
      copy_log_tooltip: "Copy log to clipboard",
      loading_log: "Loading log...",
      log_empty: "Log file is empty or was not found.",
      failed_to_load_log: "Failed to load log",

      // ExecutionMemories -- memories created during an execution
      loading_memories: "Loading memories",
      // {count} = number of memories
      memories_created: "Memories Created ({count})",

      // ExecutionDetailTabs -- tab labels
      tab_detail: "Detail",
      tab_inspector: "Inspector",
      tab_trace: "Trace",
      tab_pipeline: "Pipeline",
      tab_replay: "Replay",

      // ExecutionSummaryCard -- cancelled execution
      stopped_while_running: "Stopped while running",
      resume_from_here: "Resume from here",

      // ErrorExplanationCard
      error_label: "Error",

      // AiHealingCounters -- healing phase labels
      healing_started: "AI Healing started",
      healing_diagnosing: "Diagnosing...",
      // {count} = number of fixes
      healing_applying_one: "Applying {count} fix...",
      healing_applying_other: "Applying {count} fixes...",
      // {count} = fixes applied
      healing_completed_fixes_one: "{count} fix applied",
      healing_completed_fixes_other: "{count} fixes applied",
      healing_completed_retrying: " -- retrying",
      healing_no_fixes: "No fixes needed",
      healing_failed: "Healing failed",

      // HealingCard -- inline notification
      dismiss: "dismiss",
      // {seconds} = countdown value
      retrying_in: "Retrying in {seconds}s...",
      retrying_now: "Retrying now...",
      // {current}/{max} attempt counter
      attempt_of: "Attempt {current} of {max}",
      view_healing_issues: "View in healing issues",

      // PersonaRunner -- runner controls
      run_persona: "Run Persona",
      input_data_optional: "Input Data (Optional)",
      connect_remote: "Connect via Remote Control",
      stop_execution: "Stop Execution",
      execute_on_cloud: "Execute on Cloud",
      execute_persona: "Execute Persona",
      verification_failed: "Could not verify a previously running execution. It may still be active on the backend.",
      dismiss_abandon: "Dismiss and abandon execution",
      // {elapsed} = formatted elapsed time
      elapsed: "{elapsed} elapsed",
      // {elapsed} = formatted typical duration
      typically_completes: "Typically completes in ~{elapsed}",
      taking_longer: "Taking longer than usual...",
      // {name} = persona name
      ready_to_execute: "Ready to execute \u2014 click Run or press",
      // Queue position
      // {position} = queue position, {depth} = queue depth
      queued_position: "Queued -- position {position}",
      queued_position_of: "Queued -- position {position} of {depth}",
      phases: "Phases",

      // BudgetRecoveryCard
      approaching_budget: "Approaching budget limit",
      budget_exceeded: "Monthly budget exceeded",
      // {spend}/{limit} = dollar amounts, {percent} = usage percentage
      budget_spend_detail: "This agent has spent ${spend} of its ${limit} monthly limit ({percent}%). Execution is paused to prevent unexpected costs.",
      run_anyway_session: "Run anyway (this session)",
      raise_budget: "Raise budget",
      // {days} = days until reset
      resets_in: "Resets {days}",
      budget_unavailable: "Budget data unavailable",
      budget_unavailable_detail: "Could not verify current spend. Execution is blocked as a safety precaution until budget data refreshes.",
      run_anyway: "Run anyway",
      retrying_automatically: "Retrying automatically...",

      // StuckExecutionGuidance
      execution_stuck: "Execution appears stuck",
      no_new_output: "No new output for a while",
      stuck_tooltip: "The agent has not produced output for 2+ minutes. It may be waiting on an external API or encountering an issue.",
      silent_tooltip: "The agent has been silent for over a minute. This can happen during long API calls or complex reasoning.",
      stuck_detail: "The agent has not produced any output for over 2 minutes. This usually means it is waiting on a slow external API, the connected service is unresponsive, or the execution process has stalled.",
      silent_detail: "The agent has been silent for over a minute. Long pauses can occur during complex reasoning or when waiting for API responses. If the silence continues, the status will escalate.",
      suggested_actions: "Suggested actions",
      cancel_retry: "Cancel & retry",
      view_execution_log: "View execution log",
      wait_hint: "You can also wait \u2014 some operations take time",
      connectivity_tip: "Tip: Check if the connected API or service is responding. Network issues or rate limits can cause prolonged silence.",

      // ExecutionPreviewPanel
      preview: "Preview",
      estimating: "Estimating...",
      est: "est.",
      of_budget: "{percent}% of budget",
      monthly_spend: "Monthly Spend",
      unlimited: "unlimited",
      input_cost: "Input Cost",
      output_cost_est: "Output Cost (est.)",
      prompt_preview: "Prompt Preview",

      // ExecutionComparison
      execution_comparison: "Execution Comparison",
      what_changed: "What Changed",
      left: "Left",
      right: "Right",
      // {count} = retry count
      retry_count: "retry #{count}",
      tool_call_timeline: "Tool Call Timeline",
      input_data_diff: "Input Data Diff",
      output_data_diff: "Output Data Diff",

      // ExecutionInspector
      // {count} = step count
      tool_call_timeline_steps: "Tool Call Timeline ({count} steps)",
      no_tool_calls: "No tool calls recorded",
      tool_steps_appear: "Tool steps appear after execution completes",
      cost_breakdown: "Cost Breakdown",
      unknown_model_pricing: "Unknown model -- no pricing data",
      // CostBreakdownBar labels
      input_label: "Input: {cost}",
      output_label: "Output: {cost}",
      total_label: "Total: {cost}",
      input_pct: "Input ({percent}%)",
      output_pct: "Output ({percent}%)",

      // ToolCallCard
      input: "Input",
      output: "Output",
      pending: "pending",

      // TraceInspector
      loading_trace: "Loading trace",
      failed_to_load_trace: "Failed to load trace: {error}",
      no_trace_data: "No trace data recorded",
      trace_spans_appear: "Trace spans appear during execution",
      span: "Span",
      errors: "Errors",

      // TraceSummary
      duration: "Duration",
      tokens: "Tokens",
      spans: "Spans",
      // {count} = evicted span count
      trace_incomplete: "Trace incomplete: {count} span evicted (limit: 10,000)",
      trace_incomplete_other: "Trace incomplete: {count} spans evicted (limit: 10,000)",

      // PipelineWaterfall
      no_pipeline_trace: "No pipeline trace available",
      pipeline_traces_captured: "Pipeline traces are captured for new executions",
      legend_frontend: "Frontend",
      legend_backend: "Backend",
      legend_engine: "Engine",
      legend_tool_call: "Tool Call",
      live: "Live",
      stage: "Stage",
      stage_errors: "Stage Errors",
      // PipelineSummary
      total_duration: "Total Duration",
      stages: "Stages",

      // CostAccrualOverlay
      cost_accrual: "Cost Accrual -- ${cost}",

      // ReplayTheater / ReplaySandbox
      execution_theater: "Execution Theater",
      loading_theater: "Loading execution theater...",
      loading_execution_data: "Loading execution data...",
      tools: "Tools",
      trace: "Trace",
      // ReplayTransportControls
      jump_to_start: "Jump to start (Home)",
      previous_step: "Previous step (Shift+Left)",
      play_pause: "Play/Pause (Space)",
      next_step: "Next step (Shift+Right)",
      jump_to_end: "Jump to end (End)",
      clear_fork_point: "Clear fork point",
      // {step} = step number
      fork_after_step: "Fork after step {step}",
      fork_input_parse_error: "Original input data could not be parsed \u2014 using empty input",

      // ReplayToolPanel
      tool_steps: "Tool Steps",
      no_tool_calls_recorded: "No tool calls recorded",

      // ReplayTerminalPanel
      // {visible}/{total} = line counts
      lines_count: "{visible}/{total} lines",
      scrub_forward: "Scrub forward to see output...",

      // ReplayCostPanel
      // {completed}/{total} = step counts
      steps_count: "{completed}/{total} steps",

      // MiniPlayerPinButton
      unpin_mini_player: "Unpin mini-player",
      pin_to_mini_player: "Pin to mini-player",
      pinned: "Pinned",
      pin: "Pin",

      // CircuitBreakerIndicator
      cb_all_paused: "All providers paused",
      // {count} = number of unavailable providers
      cb_providers_unavailable_one: "{count} provider temporarily unavailable",
      cb_providers_unavailable_other: "{count} providers temporarily unavailable",
      // {count} = number of interruptions
      cb_interruptions_one: "{count} interruption in last hour",
      cb_interruptions_other: "{count} interruptions in last hour",
      cb_connected: "Connected",
      cb_disconnected: "Disconnected",
      cb_reconnecting: "Reconnecting",
      cb_paused: "Paused",
      cb_healthy: "healthy",
      // {count} = consecutive failures, {seconds} = cooldown
      cb_errors_retrying: "{count} error(s) \u2014 retrying in {seconds}s",
      // {count} = consecutive failures
      cb_errors: "{count} error(s)",
      // {count} = trip count per hour
      cb_interruptions_per_hour: "({count} interruption(s)/1h)",
      // {count} = total global failures, {seconds} = cooldown
      cb_global_paused_detail: "All providers paused due to repeated errors ({count} total).",
      cb_resuming_in: "Resuming automatically in {seconds}s.",
      // {count} = number of transitions
      cb_show_activity: "Show recent activity ({count})",
      cb_hide_activity: "Hide recent activity ({count})",

      // ComparisonDiff
      terminal_output_diff: "Terminal Output Diff",
      // {count} = number of differences
      differences_count: "{count} differences",
      no_log_data: "No log data available",
      identical: "identical",
      // {count} = number of diffs
      diff_count_one: "{count} diff",
      diff_count_other: "{count} diffs",
      no_differences: "No differences",
      no_tool_calls_short: "No tool calls",
      cancel: "Cancel",
      // {count} = execution count in chain
      chain_executions: "{count} executions",

      // ChainCascadeTimeline
      chain_cascade: "Chain Cascade",
      loading_chain_cascade: "Loading chain cascade...",

      // HealingOverlay
      ai_healing_diagnosis: "AI Healing Diagnosis",
      loading_healing_data: "Loading healing data...",
      failure_point: "Failure Point",
      // {count} = number of healing issues
      healing_issues_count: "Healing Issues ({count})",
      auto_fixed: "Auto-fixed",
      circuit_breaker: "Circuit Breaker",
      suggested_fix: "Suggested Fix",
      retry_chain: "Retry Chain",
      no_healing_issues: "No healing issues recorded for this execution.",

      // ExpandableToolStep
      fork_after_this: "Fork after this step",
      running_ellipsis: "running...",

      // ReplayTracePanel
      trace_spans: "Trace Spans",
      no_trace_available: "No trace data available",
      engine_activity: "Engine Activity",
      // {count} = active span count
      active_count: "{count} active",
      active_now: "Active Now",
      recently_completed: "Recently Completed",
      upcoming: "Upcoming",

      // DreamReplayTheater
      dream_replay: "Dream Replay",
      zero_tokens: "0 tokens",
      incomplete_trace: "incomplete trace",
      // {spans}/{frames} = counts
      spans_frames: "{spans} spans / {frames} frames",
      span_boundaries: "Span Boundaries",
      no_active_spans: "No active spans",
      none_yet: "None yet",
      // {count} = additional items
      plus_more: "+{count} more",
      metadata_label: "Metadata",
      active_spans: "Active Spans",
      no_active_spans_frame: "No active spans at this frame",
      cost_accumulation: "Cost Accumulation",
      dream_replay_cost: "Dream Replay Cost",
      dream_replay_zero: "Replaying from stored traces -- zero LLM tokens consumed",
      deterministic_replay: "Deterministic replay \u2014 no LLM calls",
      loading_dream_replay: "Loading dream replay...",
      no_dream_trace: "No trace data available for dream replay",
      // {index}/{total} = frame position
      frame_count: "Frame {index}/{total}",

      // Phase labels (shared across runner)
      phase_initializing: "Initializing",
      phase_thinking: "Thinking",
      phase_calling_tools: "Running tools",
      phase_delegating: "Delegating to workflow",
      phase_responding: "Responding",
      phase_finalizing: "Finalizing",
      phase_error: "Error",

      // Status labels
      status_connected: "Connected",
      status_disconnected: "Disconnected",
      status_reconnecting: "Reconnecting",

      // Comparison metrics
      failed_to_load_logs: "Failed to load execution logs for comparison",
      failed_to_load_chain: "Failed to load retry chain for comparison",

      // Re-run states
      running_state: "Running...",
      execution_started: "Execution started",
      rerun_failed: "Re-run failed",
      rerun_execution: "Re-run execution",

      // Misc labels shared across files
      output_panel: "Output",
      cancel_compare: "Cancel",
      compare_btn: "Compare",
      category_label: "Category: {category}",
      status_label: "Status: {status}",

      // Waterfall / trace sub-span labels
      tool_type_badge: "Tool",
      step_number: "step #{index}",
      input_preview_prefix: "in:",
      offset_prefix: "offset:",
      step_tooltip: "Step {step}: {name}",
      ms_into_stage: "{ms}ms into stage",
    },

    // -----------------------------------------------------------------
    //  LAB -- arena, improve, breed, evolve, versions, regression
    // -----------------------------------------------------------------
    lab: {
      // LabTab -- mode tabs
      mode_arena: "Arena",
      mode_arena_desc: "Compare models head-to-head",
      mode_improve: "Improve",
      mode_improve_desc: "AI-driven prompt improvement",
      mode_breed: "Breed",
      mode_breed_desc: "Cross-breed top performers",
      mode_evolve: "Evolve",
      mode_evolve_desc: "Auto-evolving optimization",
      mode_versions: "Versions",
      mode_versions_desc: "Track prompt evolution",
      mode_regression: "Regression",
      mode_regression_desc: "Test against baseline",
      loading: "Loading...",
      auto_optimize: "Auto-Optimize",
      auto_optimize_enabled: "Auto-optimization enabled (weekly arena + improve)",
      auto_optimize_disabled: "Enable automatic prompt optimization",

      // LabProgress -- phase labels
      phase_drafting: "Drafting",
      phase_generating: "Generating",
      phase_executing: "Executing",
      phase_summarizing: "Summarizing",
      // Phase detail messages
      generating_draft: "Generating draft persona...",
      generating_scenarios: "Generating test scenarios...",
      generating_summary: "Generating test summary...",
      // {modelId} = model name, {scenario} = scenario name
      testing_model: "Testing {modelId} \u2014 {scenario}",
      // Score labels
      score_tool: "Tool: {score}",
      score_output: "Output: {score}",
      score_protocol: "Protocol: {score}",

      // LabHistoryTable
      delete_run: "Delete run",
      col_time: "Time",

      // ArenaPanel
      no_prompt_warning: "This persona has no prompt configured. Add a prompt first.",
      no_tools_warning: "This persona has no tools assigned. Add tools for richer testing.",
      add_prompt_first: "Add a prompt to this persona first",
      select_model: "Select at least one model",
      // {count} = model count, {useCase} = optional use case name
      run_arena: "Run Arena ({count} model{count, plural, one {} other {s}})",
      cancel_test: "Cancel Test",
      focus_use_case: "Focus on Use Case",

      // MatrixPanel
      describe_changes: "Describe your desired changes",
      describe_changes_placeholder: "e.g. Make the greeting more formal and add multi-language support for German and French",
      describe_changes_hint: "Claude will generate a draft persona based on your instructions, then test both current and draft versions side by side.",
      generate_test_draft: "Generate & Test Draft",
      cancel_matrix_test: "Cancel Matrix Test",

      // Shared score labels
      score_excellent: "Excellent",
      score_good: "Good",
      score_fair: "Fair",
      score_weak: "Weak",
      score_poor: "Poor",
      composite_score: "Composite Score",
      tool_usage: "Tool Usage",
      output_quality: "Output Quality",
      protocol: "Protocol",
      tool_accuracy: "Tool Accuracy",
      protocol_compliance: "Protocol Compliance",
      no_results: "No results to display",
      evaluation_insights: "Evaluation Insights",
      improvement_suggestions: "Improvement Suggestions",
      scenario_breakdown: "Scenario Breakdown",
      click_cell_details: "Click a cell for details",
      tied: "tied",
      winner: "Winner",
      best_badge: "Best",

      // AbHistory
      ab_comparison: "Comparison",
      ab_scenarios: "Scenarios",
      ab_no_runs: "No A/B test runs yet",
      ab_no_runs_subtitle: "Select two versions and run a comparison",
      ab_history_title: "A/B History",
      ab_mode_label: "A/B Test",

      // AbPanel
      select_version_a: "Select Version A to continue",
      select_version_b: "Select Version B to continue",
      run_ab_test: "Run A/B Test",
      cancel_ab_test: "Cancel A/B Test",
      version_a: "Version A",
      version_b: "Version B",
      select_version: "Select version",
      test_input_label: "Test Input (optional JSON)",

      // AbResultsView
      ab_test_summary: "A/B Test Summary",
      head_to_head: "Head-to-Head",

      // ArenaHistory
      models_column: "Models",
      scenarios_column: "Scenarios",
      best_column: "Best",
      winner_scores: "Winner Scores",
      no_arena_runs: "No arena runs yet",
      no_arena_runs_subtitle: "Select models above and run a test",
      arena_history_title: "Arena History",
      arena_mode_label: "Arena",

      // ArenaResultsView
      test_summary: "Test Summary",
      model_performance: "Model Performance",
      insights_suggestions: "Insights & Suggestions",

      // EvalHistory
      versions_column: "Versions",
      no_eval_runs: "No evaluation runs yet",
      no_eval_runs_subtitle: "Select versions and models, then run",
      eval_history_title: "Eval History",
      eval_mode_label: "Evaluation",

      // EvalPanel
      prompt_versions_label: "Prompt Versions (select 2+)",
      select_2_versions: "Select at least 2 prompt versions",
      run_eval_matrix: "Run Evaluation Matrix",
      cancel_eval: "Cancel Eval",
      min_2_versions_warning: "At least 2 prompt versions are needed. Create more versions in the Versions tab.",

      // EvalRadarChart
      radar_title: "Model Performance Radar",

      // EvalResultsGrid
      eval_summary: "Evaluation Summary",
      version_model_matrix: "Version x Model Matrix",
      avg_column: "Avg",
      version_column: "Version",
      scenario_column: "Scenario",

      // EvalVersionCards
      version_performance: "Version Performance",
      composite_label: "Composite",

      // EvolutionPanel
      select_persona_evolution: "Select a persona to configure auto-evolution",
      auto_evolution: "Auto-Evolution",
      auto_evolution_subtitle: "Continuously evolve this persona through lab-driven optimization",
      darwinian_evolution: "Darwinian Evolution",
      disable_auto_evolution: "Disable auto-evolution",
      enable_auto_evolution: "Enable auto-evolution",
      cycles_label: "Cycles",
      promotions_label: "Promotions",
      next_cycle: "Next Cycle",
      ready_label: "Ready",
      waiting_label: "Waiting",
      evolving: "Evolving...",
      trigger_evolution: "Trigger Evolution Cycle",
      mutation_rate: "Mutation Rate",
      variants_per_cycle: "Variants per Cycle",
      improvement_threshold: "Improvement Threshold",
      min_execs_between: "Min Executions Between",
      save_settings: "Save Settings",
      evolution_history: "Evolution History",
      variants_tested: "{count} variants tested",
      promoted_label: "Promoted",
      self_improving_title: "Self-improving personas",
      self_improving_desc: "Enable auto-evolution to continuously optimize this persona. After each batch of executions, variants are automatically generated, evaluated, and promoted if they outperform the current configuration.",
      quality_label: "Quality",
      speed_label: "Speed",
      cost_label: "Cost",

      // GenomeBreedingPanel
      genome_breeding: "Genome Breeding",
      genome_breeding_subtitle: "Cross-breed top-performing personas to discover novel configurations",
      select_parents: "Select Parents (2-5 personas)",
      no_personas_available: "No personas available",
      fitness_objective: "Fitness Objective",
      overall_label: "Overall",
      generations_label: "Generations",
      breeding_ellipsis: "Breeding...",
      breeding_history: "Breeding History",
      evolution_progress: "Evolution Progress",
      evolution_progress_subtitle: "Fitness trajectory across generations",
      offspring_subtitle: "Adopt top performers as new personas",
      breeding_in_progress: "Breeding in progress...",
      breeding_results_hint: "Results will appear when the breeding run completes",
      evolve_personas_title: "Evolve your personas",
      evolve_personas_desc: "Select 2-5 parent personas above, tune the fitness objective, then click Start Breeding. The genetic algorithm will cross-breed prompts, tools, and model configurations to discover novel high-performing variants.",
      adopt_as_persona: "Adopt as Persona",
      adopted: "Adopted",
      compare_parent: "Compare with parent",

      // GenerationEvolutionChart
      best_legend: "Best",
      avg_legend: "Avg",
      worst_legend: "Worst",
      total_offspring: "{count} total offspring",

      // GenomeDiffView
      genome_diff: "Genome Diff",
      prompt_segments_section: "Prompt Segments",
      tools_section: "Tools",
      model_section: "Model",
      config_section: "Config",
      no_changes: "No changes",

      // MatrixHistory
      instruction_column: "Instruction",
      draft_column: "Draft",
      accepted_label: "Accepted",
      pending_label: "Pending",
      no_matrix_runs: "No matrix runs yet",
      no_matrix_runs_subtitle: "Describe a change above to generate and test a draft",
      matrix_history_title: "Matrix History",
      matrix_mode_label: "Matrix",

      // MatrixResultsView
      draft_changes: "Draft Changes",
      current_column: "Current",
      accept_draft: "Accept Draft",
      accept_applies_desc: "Accept applies the draft prompt to the persona, creating a new prompt version.",
      draft_accepted: "Draft accepted and applied",

      // MatrixScoreComparison
      score_comparison: "Score Comparison",
      metric_column: "Metric",
      delta_column: "Delta",

      // RegressionPanel
      no_baseline_title: "No Baseline Pinned",
      no_baseline_subtitle: "Pin a prompt version as baseline in the Versions tab to enable regression testing.",
      go_to_versions: "Go to Versions",
      compare_against: "Compare against:",
      models_to_test: "Models to test:",
      regression_threshold: "Regression threshold:",
      threshold_hint: "pts (fail if composite score drops more than this)",
      running_regression: "Running Regression Check...",
      run_regression: "Run Regression Check",

      // RegressionResultsView
      no_regressions: "No Regressions Detected",
      improved_over_baseline: "Improved Over Baseline",
      no_comparable_scenarios: "No comparable scenarios found between baseline and current eval results.",
      per_scenario_results: "Per-Scenario Results",

      // DraftDiffViewer
      no_structural_diff: "No structural differences detected",
      no_changes_diff: "No changes",

      // ImprovePromptButton
      improvement_run_started: "Improvement run started",
      analyzing_patching: "Analyzing and patching prompt...",
      auto_improve: "Auto-Improve Prompt",

      // InlineDiffPreview
      no_prompt_changes: "No prompt changes",

      // ScenarioDetailPanel
      evaluation_notes: "Evaluation Notes",
      how_to_fix: "How to Fix This",
      rate_label: "Rate",
      agent_output: "Agent Output",
      tool_calls: "Tool Calls",
      expected_label: "Expected",
      actual_label: "Actual",
      none_specified: "None specified",
      none_label: "None",
      composite_score_formula: "Composite Score (TA 40% + OQ 40% + PC 20%)",

      // ScoreTrendCard
      score_trend: "Score Trend",
      run_tests_hint: "Run tests to see score trends",

      // PromptTimeline
      prompt_timeline: "Prompt Timeline",
      no_versions_yet: "No prompt versions yet",
      versions_auto_created: "Versions are created automatically when the prompt is modified through the Lab or Matrix build.",

      // TimelineEntry
      no_change_summary: "No change summary",
      initial_version: "Initial version \u2014 no previous version to compare",
      promote_action: "Promote",
      archive_action: "Archive",
      rollback_action: "Rollback",

      // UserRating
      thumbs_down: "Thumbs down",
      neutral_rating: "Neutral",
      thumbs_up: "Thumbs up",
      saved_label: "Saved",
      what_went_wrong: "What went wrong? (optional)",

      // VersionsPanel
      no_persona_selected: "No persona selected",
      persona_versions: "Persona Versions",
      persona_versions_subtitle: "Prompts, tools, and settings",
      no_versions: "No versions yet",
      versions_auto_edit: "Versions are created automatically when you edit the prompt",
      select_two_compare: "Select two versions to compare",
      click_a_b_hint: "Click the A and B buttons on any version",
      run_ab_versions: "Run these versions in A/B test",
      run_check: "Run Check",
      error_rate_monitor: "Error Rate Monitor",
      last_10_execs: "Last 10 executions",
      error_rate_rollback_hint: "If error rate exceeds 50% after a prompt change, rollback to the production version using the version list.",

      // VersionItem
      actions_label: "Actions",
      promote_to_production: "Promote to Production",
      unarchive_action: "Unarchive",
      rollback_to_this: "Rollback to this",
      pin_as_baseline: "Pin as Baseline",
      unpin_baseline: "Unpin Baseline",
      operation_failed: "Operation Failed",

      // ModelToggleGrid
      models_header: "Models",
      ollama_local: "Ollama (local)",

      // UseCaseFilterPicker
      all_use_cases: "All Use Cases",

      // LabResultModal
      results_suffix: "Results",

      // LabQualityBadge
      quality_score_title: "Score: {score} | {coverage} scenarios tested | {date}",
      quality_score_inline: "Score: {score} | {coverage} scenarios",

      // LabActionButtons
      cancel_default: "Cancel",

      // GroupedToolRow
      hide_impact: "Hide impact",
      show_impact: "Show impact",
    },

    // -----------------------------------------------------------------
    //  DESIGN -- AI design wizard, design conversations, drift
    // -----------------------------------------------------------------
    design: {
      // DesignTab -- empty state
      select_agent: "Select an agent to start design analysis",

      // DesignPhasePanel -- mode toggle buttons
      mode_design: "Design",
      mode_intent: "Intent Compiler",
      mode_example: "Show by Example",
      compile_from_examples: "Compile from Examples",
      compile_intent: "Compile Intent",
      analyze_build: "Analyze & Build",
      // Intent compiler
      intent_placeholder: "Describe what you want this agent to do in plain language...\n\ne.g. \"Monitor our Stripe account for failed payments over $100 and notify the finance team on Slack with a summary\"",
      intent_submit_hint: "Press Enter to submit, Shift+Enter for new line.",
      intent_detail: "The compiler will generate a complete configuration: prompt, tools, triggers, use cases, model recommendation, and test scenarios.",
      // Example mode
      example_context_placeholder: "Optional: add context or constraints (e.g. \"always prioritize P1 tickets\", \"post to #alerts channel\")",

      // DesignQuestionPanel
      clarification_needed: "Clarification Needed",
      or_type_answer: "or type your answer",
      type_custom_answer: "Type a custom answer...",
      answer: "Answer",
      ctrl_enter_submit: "Ctrl+Enter to submit",
      cancel_design: "Cancel Design",

      // DesignPhaseAnalyzing
      updating_design: "Updating design...",

      // DesignPhaseRefining
      current_design: "Current design",

      // DesignPhaseApplying
      applying_changes: "Applying changes...",

      // DesignPhasePreview
      will_apply: "Will apply: ",
      apply_changes: "Apply Changes",
      refine: "Refine",
      discard: "Discard",
      confirm_discard: "Confirm discard?",
      describe_changes_to_refine: "Describe what to change...",
      enter_submit_hint: "Press Enter to submit, Shift+Enter for new line.",

      // DesignPhaseError
      design_failed: "Design analysis failed",

      // DesignPhaseApplied
      // {count} = number of warnings
      applied_with_warnings_one: "Applied with {count} warning",
      applied_with_warnings_other: "Applied with {count} warnings",
      agent_configured: "Agent configured!",
      // {count} = number of failed operations
      operations_failed_one: "{count} operation failed",
      operations_failed_other: "{count} operations failed",
      retrying: "Retrying...",
      // {count} = number of failed operations
      retry_failed: "Retry {count} failed",
      next_steps: "Next steps",
      // Applied details -- next step cards
      configure_credentials: "Configure Credentials",
      configure_credentials_desc: "Connect the services your agent needs",
      set_up_triggers: "Set Up Triggers",
      set_up_triggers_desc: "Configure when your agent should run",
      run_test_execution: "Run Test Execution",
      run_test_execution_desc: "Verify your agent works as expected",
      review_prompt: "Review Prompt",
      review_prompt_desc: "Fine-tune the generated prompt",

      // PhaseIndicator -- step labels in the progress bar
      phase_progress_label: "Design phase progress",
      stage_input: "Input",
      stage_analyzing: "Analyzing",
      stage_question: "Question",
      stage_review: "Review",
      stage_applied: "Applied",
      stage_error: "Error",

      // IntentResultExtras -- collapsible detail sections
      label_expected: "Expected",
      label_sample_input: "Sample Input",
      label_intent: "Intent",
      label_model_recommendation: "Model Recommendation",
      label_model: "Model",
      label_est_cost_run: "Est. Cost/Run",
      label_complexity: "Complexity",
      // {count} = number of use cases
      use_cases_title: "Use Cases",
      // {count} = number of test scenarios
      test_scenarios_title: "Test Scenarios",

      // ConversationMessageList -- conversation card details
      // {count} = number of messages
      msg_count_one: "{count} msg",
      msg_count_other: "{count} msgs",
      resume: "Resume",

      // DesignConversationHistory -- section titles
      design_drift: "Design Drift",
      design_sessions: "Design Sessions",

      // PairItem / ExamplePairCollector -- input/output example builder
      // {index} = 1-based example number
      example_n: "Example {index}",
      remove_example: "Remove example",
      input_label: "Input -- what the agent receives",
      output_label: "Output -- what you want the agent to produce",
      input_placeholder: "Paste a real input...\n\ne.g. an email body, a Slack message, an incoming request, a CSV row",
      output_placeholder: "Describe or paste the desired output...\n\ne.g. \"Create a Jira ticket with title from subject, priority P2, assigned to backend team\"",
      example_instructions: "Paste a real input (email, incoming request, message) and show the output you want. The compiler reverse-engineers the full agent configuration from your examples.",
      add_first_example: "Add your first input -> output example",

      // DesignPhasePanelSaved -- chat input for modifications
      current_config_preserved: "Current configuration will be preserved. Describe what to change.",
      describe_changes_placeholder: "Describe changes to this design...",
      update_design: "Update Design",

      // DesignWizard
      switch_to_manual: "Switch to manual",
      generate_design: "Generate Design",
      next: "Next",
      go_back_hint: "Go back and answer the questions to configure your agent.",
      additional_instructions: "Additional instructions or context (optional)",
      additional_instructions_placeholder: "Add any specific requirements, domain knowledge, or constraints...",
    },

    // -----------------------------------------------------------------
    //  CONNECTORS -- connector assignment, automations, notifications
    // -----------------------------------------------------------------
    connectors: {
      // Section label shown above the connector icon row
      connectors_label: "Connectors",
      // View mode buttons
      list_view: "List view",
      graph_view: "Dependency graph",
      no_persona: "No persona selected",

      // -- Automation --
      auto_title: "Automations",
      auto_active: "{count} active",
      auto_add: "Add",
      auto_add_from_platforms: "Add automation from n8n, Zapier, or GitHub Actions",
      auto_delete_title: "Delete Automation",
      auto_delete_msg: "Permanently delete {name}.",
      auto_edit: "Edit",
      auto_pause: "Pause",
      auto_activate: "Activate",
      auto_confirm: "Confirm?",
      auto_test: "Test",
      auto_configure: "Configure",
      auto_fallback: "Fallback",
      auto_last_run: "Last run: {time}",
      auto_never_triggered: "Never triggered",
      auto_not_deployed: "Not deployed",
      // Modal titles
      auto_modal_add: "Add Automation",
      auto_modal_configure: "Configure Automation",
      auto_modal_designing: "Designing Automation...",
      auto_modal_review: "Review Automation",
      auto_modal_deploying: "Deploying...",
      auto_modal_deployed: "Automation Deployed",
      auto_modal_failed: "Deployment Failed",
      // Modal footer
      auto_start_over: "Start over",
      auto_deploy_save: "Deploy & Save",
      auto_name_required: "Enter a name to continue",
      auto_cred_required: "Select a credential before deploying",
      // Trigger step
      auto_describe: "Describe what you want this automation to do. AI will design and deploy the workflow automatically.",
      auto_describe_placeholder: "e.g. Process uploaded CSV files, extract key data, and push results to Google Sheets",
      auto_target_platform: "Target platform:",
      auto_creds_required: "{label} credentials required",
      auto_add_key_hint: "Add your {label} API key in the Vault to enable direct workflow management and deployment.",
      auto_add_creds: "Add {label} Credentials",
      auto_connected: "{label} connected",
      auto_missing_perms: "Missing GitHub permissions",
      auto_repo_required: "Repository (required)",
      auto_loading_repos: "Loading repositories...",
      auto_select_repo: "Select a repository...",
      auto_no_repos: "No repositories found. Check your token permissions.",
      auto_your_zaps: "Your existing Zaps",
      auto_loading_zaps: "Loading your Zaps...",
      auto_no_zaps: "No existing Zaps found. A new Zap will be created during deployment.",
      auto_zaps_ref: "AI will design a new Zap with a catch hook for your agent. Existing Zaps are shown for reference.",
      auto_ctrl_enter: "Ctrl+Enter to submit",
      auto_complete_fields: "Complete all required fields first",
      auto_design_ai: "Design with AI",
      // Action step (progress)
      auto_elapsed: "{elapsed}s elapsed",
      auto_typically: "Typically 15-30 seconds",
      // Condition step
      auto_ai_recommendation: "AI recommendation:",
      auto_name_label: "Name",
      auto_platform_label: "Platform",
      auto_credential_label: "Credential",
      auto_none_selected: "None selected",
      auto_what_will_happen: "What will happen",
      auto_replaces: "Replaces connectors",
      auto_show_advanced: "Show advanced settings",
      auto_hide_advanced: "Hide advanced settings",
      auto_input_schema: "Input Schema",
      auto_on_failure: "On failure",
      auto_timeout: "Timeout",
      auto_seconds: "seconds",
      auto_deploy_failed: "Deployment failed",
      // Review step
      auto_deploying_to: "Deploying to {platform}...",
      auto_deploy_n8n: "Creating workflow and activating on your n8n instance",
      auto_deploy_github: "Setting up repository dispatch integration",
      auto_deploy_zapier: "Validating and connecting catch hook",
      auto_deploy_custom: "Saving automation configuration",
      auto_deployed_warning: "Automation deployed with warning",
      auto_deployed_ok: "Automation deployed successfully",
      auto_view_on: "View on {platform}",
      auto_done: "Done",
      auto_design_failed: "Design failed",
      auto_unknown_error: "Unknown error",
      auto_try_again: "Try Again",
      // Platform hints
      auto_n8n_hint: "Workflow will be created and activated on your n8n instance automatically.",
      auto_github_hint: "Repository dispatch configured for {repo}",
      auto_event_type: "Event type: {eventType}",
      auto_zapier_hint: "Catch hook will be validated and connected.",
      auto_custom_hint: "Manual setup required. Automation will be saved as draft.",

      // -- Notification channels --
      ch_title: "Notification Channels",
      ch_add: "Add Channel",
      ch_all_added: "All channel types added",
      ch_in_app: "In-App Messages",
      ch_always_active: "Always active",
      ch_enable: "Enable {type} notifications",
      ch_credential: "Credential",
      ch_connected: "Connected",
      ch_cred_needed: "Credential needed",
      ch_sending: "Sending...",
      ch_delivered: "Delivered",
      ch_failed: "Failed",
      ch_test: "Test Notification",
      ch_saving: "Saving...",
      ch_save: "Save Channels",
      ch_delivery_health: "Delivery Health",
      ch_no_deliveries: "No deliveries yet",

      // -- Connector status --
      st_test: "Test",
      st_test_all: "Test All",
      st_link_existing: "Link Existing",
      st_add_new: "Add New",
      st_credential: "Credential: {name}",
      st_best_match: "Best match",
      st_other_creds: "Other credentials",
      st_swap_alt: "Swap to alternative",
      st_unlinked_warn: "{count} connector(s) missing credentials -- execution blocked",
      st_unlinked_hint: "Link or create credentials for all connectors to enable execution.",
      st_unhealthy_warn: "{count} connector(s) failed healthcheck -- execution may fail at runtime",
      st_unhealthy_hint: "Re-test or re-link credentials for failing connectors.",
      st_required: "{count} connector(s) required",
      st_healthy: "{count} healthy",
      st_failed: "{count} failed",
      st_missing: "{count} missing",

      // -- Tools section (within connectors tab) --
      ts_configured: "{count} tool(s) configured",
      ts_no_tools: "No tools configured.",
      ts_hide_runner: "Hide Tool Runner",
      ts_try_tools: "Try Tools ({count})",

      // -- Credential picker --
      cp_select: "Select credential...",
      cp_none: "None",
      cp_no_creds: "No credentials available",
      cp_select_label: "Select credential",

      // -- Connectors tab --
      ct_no_persona: "No persona selected",
      ct_connectors_label: "Connectors",
      ct_list_view: "List view",
      ct_graph_view: "Dependency graph",
      ct_swap_alt_tooltip: "Swap to alternative connector",
      // {count} = dependency count
      ct_deps: "{count} dep(s)",

      // -- Dependency graph --
      dg_no_deps: "No dependencies to display.",
      dg_broken: "{count} broken",
      dg_blast_radius: "Blast Radius",
      dg_dependencies: "Dependencies",
      dg_select_cred: "Select a credential to see what breaks when it expires",
      dg_relationships: "Relationships ({count})",
      dg_more: "+{count} more",
      dg_affected_tools: "Affected Tools",
      dg_affected_auto: "Affected Automations",
      dg_low_risk: "Low Risk",
      dg_medium_risk: "Medium Risk",
      dg_high_risk: "High Risk",
      // {count} = affected count
      dg_high_blast: "If this credential expires or goes offline, {count} capabilities will break.",
      dg_medium_blast: "{count} capabilities depend on this credential.",
      dg_low_blast: "No tools or automations depend on this credential.",

      // -- Agent credential demands --
      dm_needed: "{count} credential(s) needed",
      dm_fulfilled: "{fulfilled}/{total} connector(s) fulfilled",
      dm_reuse_hint: "{count} can reuse existing credentials",
      dm_required_by: "Required by tools -- no credential linked",
      dm_reuse: "Reuse ({count})",
      dm_create: "Create",
      dm_link_existing: "Link an existing credential:",

      // -- Subscriptions --
      sub_title: "Event Subscriptions",
      sub_active: "{count} active",
      sub_add: "Add Subscription",
      sub_confirm: "Confirm?",
      sub_triggers_title: "Triggers & Subscriptions",
      sub_suggested: "{count} suggested",
      sub_filter: "filter: {filter}",
    },

    // -----------------------------------------------------------------
    //  EDITOR CHROME -- tab bar, banners, header, quick stats
    // -----------------------------------------------------------------
    editor_chrome: {
      tab_activity: "Activity",
      tab_matrix: "Matrix",
      tab_use_cases: "Use Cases",
      tab_lab: "Lab",
      tab_connectors: "Connectors",
      tab_chat: "Chat",
      tab_settings: "Settings",
      select_agent: "Select an agent to get started",
      choose_sidebar: "Choose from the sidebar or create a new agent",
      save_failed_retry: "Save failed -- will retry on next edit",
      unsaved_changes: "Unsaved changes",
      unsaved_detail: "Unsaved changes: {sections}",
      save_switch: "Save & Switch",
      discard: "Discard",
      partial_load: "Partial load: {warnings}",
      cloud_connect: "Connect a cloud orchestrator to run personas remotely",
      cloud_signin: "Sign in to unlock cloud features and remote execution",
      sign_in: "Sign In",
      set_up_cloud: "Set up Cloud",
      active: "Active",
      off: "Off",
      execute: "Execute",
      running: "Running\u2026",
      execution_in_progress: "Execution in progress",
      cannot_enable: "Cannot enable agent",
      success_label: "Success",
      health_label: "Health",
      latency_label: "Latency",
      cost_run_label: "Cost/run",
      last_run_label: "Last run",
      rank: "Rank",
    },

    // -----------------------------------------------------------------
    //  MODEL CONFIG -- model selection, budget, comparison
    // -----------------------------------------------------------------
    model_config: {
      model_provider: "Model & Provider",
      unsaved_changes: "Unsaved changes",
      max_budget: "Max Budget (USD)",
      max_turns: "Max Turns",
      prompt_caching: "Prompt Caching",
      cache_off: "Off",
      cache_off_desc: "No caching",
      cache_short: "5 min",
      cache_short_desc: "Short retention",
      cache_long: "1 hr",
      cache_long_desc: "Long retention",
      provider_label: "Provider",
      model_name: "Model Name",
      base_url: "Base URL",
      auth_token: "Auth Token",
      effective_config: "Effective Config",
      inherited: "{count} inherited",
      overridden: "{count} overridden",
      source_agent: "Agent",
      source_workspace: "Workspace",
      source_global: "Global",
      source_default: "Default",
      tooltip_workspace: "Inherited from workspace \"{name}\"",
      tooltip_global: "Inherited from global defaults",

      // (merged from duplicate block)
      tooltip_agent_override: "Overrides workspace/global default",
      tooltip_agent_set: "Set on this agent",
      tooltip_no_value: "No value configured",
      tooltip_overriding: "Overriding inherited value",
      saved: "Saved",
      workspace_prefix: "Workspace: {label}",
      field_model: "Model",
      field_provider: "Provider",
      field_base_url: "Base URL",
      field_auth_token: "Auth Token",
      field_max_budget: "Max Budget",
      field_max_turns: "Max Turns",
      field_prompt_cache: "Prompt Cache",
    },

    // -----------------------------------------------------------------
    //  USE CASES -- use case flows, schedule, detail
    // -----------------------------------------------------------------
    use_cases: {
      no_persona: "No persona selected",
      identified: "{count} use case(s) identified",
      default_model: "Persona Default Model",
      inherit_hint: "All use cases inherit this model unless overridden below.",
      test: "Test",
      run_with: "Run with {model}",
      fixture_inputs: "Fixture inputs:",
      test_use_case: "Test Use Case",
      view_history: "View full test history",
      generating: "Generating scenarios...",
      testing_scenario: "Testing {name}...",
      active_triggers: "Active Triggers",
      active_subs: "Active Subscriptions",
      general_history: "General History",
      unlinked_execs: "({count} unlinked execution(s))",
      no_unlinked: "No unlinked executions found.",
    },

    // -----------------------------------------------------------------
    //  TOOLS -- tool selector and impact analysis
    // -----------------------------------------------------------------
    tools: {
      no_persona: "No persona selected",
      search_placeholder: "Search tools...",
      category_view: "Category view",
      connector_view: "Connector view",
      assigned_summary: "{assigned} of {total} tools assigned",
      more: "+{count} more",
      clear_all: "Clear all",
      no_matching: "No tools matching query",
      clear_filter: "Clear filter",
      no_assigned: "No tools assigned yet",
      browse_tools: "Browse available tools",
      no_available: "No tools available",
      add_credential: "Add credential",
      requires_cred: "Requires a {label} credential to connect",
      calls: "{count} calls",
      impact_label: "Impact",
      removed: "Removed {name}",
      undo: "Undo",
      general: "General",
      no_impact: "No impact data available",
      uc_section: "Use Cases",
      runs: "{count} run(s)",
      more_uc: "+{count} more",
      no_uc: "No use cases have executed this tool yet",
      removing_affects: "Removing this tool affects {count} use case(s)",
      usage_30d: "Usage (30d)",
      stat_calls: "Calls",
      stat_runs: "Runs",
      stat_agents: "Agents",
      no_usage: "No usage recorded",
      cost_impact: "Cost Impact",
      per_call: "Per call:",
      total_cost: "Total:",
      credential: "Credential",
      linked: "-- linked",
      cred_missing: "-- missing",
      often_used: "Often Used With",
    },

    // -- Chat thread (design wizard conversation) --
    chat_thread: {
      welcome: "Tell me what you need this agent to do. I'll build the full configuration -- prompt, tools, triggers -- from your description.",
      welcome_example: 'Example: "Watch my GitHub PRs and post a summary to Slack every morning"',
    },

    // -- Assign modal (component role assignment) --
    assign: {
      assign_to: "Assign to {role}",
      saved_credentials: "Saved Credentials ({count})",
      all_connectors: "All Connectors ({count})",
      search_credentials: "Search credentials...",
      search_connectors: "Search connectors...",
      no_saved_credentials: "No saved credentials yet",
      no_credentials_match: "No credentials match your search",
      vault_hint: "Save credentials in the Vault, or use the Connectors tab",
      no_connectors_match: "No connectors match your search",
    },

    credential_coverage: "{matched}/{total} credentials",

    role_card: {
      no_credential: "No credential",
      edit_tables: "edit",
      select_tables: "select tables",
      assign: "Assign",
    },

    channel_picker: {
      in_app_messaging: "In-app Messaging",
      vault_hint: "Save communication credentials (Slack, Email, etc.) in the Vault to see them here.",
    },

    connector_picker: {
      no_connectors: "No connectors available",
      search: "Search connectors...",
      no_match: 'No connectors match "{search}"',
    },

    policy_picker: {
      error_handling: "Error Handling",
      manual_review: "Manual Review",
    },

    table_selector: {
      title: "Select Tables",
      subtitle: "{label} -- choose tables to watch",
      tables_selected_one: "{count} table selected",
      tables_selected_other: "{count} tables selected",
      no_tables_selected: "No tables selected -- agent watches all",
    },

    trigger_popover: {
      trigger: "Trigger",
      clear_override: "Clear override",
    },

    use_case: {
      add: "Add use case",
      title_placeholder: "Use case title -- e.g. Handle refund requests, Summarize daily tickets",
      description_placeholder: "Describe the steps -- e.g. When a refund request arrives, verify the order, check policy, and send approval or denial",
    },

    builder_action: {
      processing: "Processing...",
      error_retry: "Something went wrong. Please try again.",
      enhancing: "Enhancing...",
      enhance_with_ai: "Enhance with AI",
      describe_agent: "Describe what your agent should do",
    },

    builder_preview: {
      title: "Preview",
      start_building: "Start building to see a preview",
      intent: "Intent",
      use_cases: "Use Cases",
      none_yet: "None yet",
      components: "Components",
      none: "None",
      credentials_covered: "Credentials: {matched}/{total} covered",
      schedule: "Schedule",
      manual_only: "Manual only",
      errors: "Errors",
      review: "Review",
    },

    dry_run: {
      ready: "Ready",
      blocked: "Blocked",
      partial: "Partial",
      issues_remaining_one: "{count} issue remaining",
      issues_remaining_other: "{count} issues remaining",
      capabilities: "Capabilities",
      issues: "Issues",
      apply_fix: "Apply Fix: {label}",
      manual_action_needed: "Manual action needed",
      no_issues: "No issues found. Your agent configuration looks good.",
    },

    identity_preview: {
      title: "Preview",
      agent_name_placeholder: "Agent Name",
      description_placeholder: "Description",
      use_cases: "Use Cases",
      more: "+{count} more",
      components: "Components",
      schedule_label: "Schedule:",
      errors_label: "Errors:",
      review_label: "Review:",
    },

    build_review: {
      agent_name: "Agent name",
      all_dimensions: "All 8 dimensions",
      prompt_generated: "Prompt generated",
      connectors_ready: "Connectors ready",
      promote_agent: "Promote Agent",
      testing: "Testing...",
      test_agent: "Test Agent",
    },

    connectors_cell: {
      add_in_keys: "Add in Keys",
      linked: "Linked",
      link: "Link",
      no_credential_found: "No {name} credential found. Add one in Keys to continue.",
      swap_to: "Swap to:",
      recalculating: "Recalculating...",
      recalculate_dimensions: "Recalculate Dimensions",
      rebuilding: "Rebuilding with new connector...",
    },

    dimension_edit: {
      add_item: "Add item...",
      add_connector: "Add connector...",
      add_trigger: "Add trigger...",
      add_task: "Add task...",
      add_channel: "Add notification channel...",
      add_memory: "Add memory item...",
      add_error_strategy: "Add error strategy...",
      add_review_rule: "Add review rule...",
      replace: "Replace",
      replace_connector: "Replace: {name}",
      pick_credential: "Pick one of your connected credentials",
      no_connected_credentials: "No connected credentials yet",
      add_credentials_hint: "Add credentials in the Keys module first.",
      open_keys: "Open Keys",
      add_credential_in_keys: "Add credential in Keys",
      healthy: "healthy",
      check_failed: "check failed",
      not_tested: "not tested",
      credential_warning: "Some connectors need healthy credentials before this dimension can be finalized",
      approval_required: "Approval Required",
      fully_automated: "Fully Automated",
      cron_label: "Cron:",
      every_label: "Every:",
      done: "Done",
    },

    quick_config: {
      title: "Quick Setup",
      start_conditions: "Start Conditions",
      apps_and_services: "Apps & Services",
      time_schedule: "Time Schedule",
      event_triggers: "Event Triggers",
      frequency: "Frequency",
      daily: "Daily",
      weekly: "Weekly",
      monthly: "Monthly",
      days: "Days",
      day_of_month: "Day of Month",
      time: "Time",
    },

    events_panel: {
      source_agent: "Source Agent",
      no_agents: "No agents available",
      events_from: "Events from {name}",
      select_agent: "Select an agent",
      loading_events: "Loading events...",
      no_subscriptions: "No event subscriptions found",
      choose_agent: "Choose an agent to see its events",
    },

    matrix_cred_picker: {
      no_stored: "No stored credentials",
      best_match: "Best match",
      other: "Other",
    },

    services_panel: {
      no_connectors: "No connectors with healthy API keys found. Add credentials in the Vault first.",
      select_table: "Select table",
    },

    spatial_question: {
      agent_configuration: "Agent Configuration",
      or_custom_answer: "Or type a custom answer",
      type_answer: "Type your answer...",
      submit: "Submit",
      press_to_select: "Press 1-{count} to select instantly",
    },

    table_picker: {
      title: "Select Table",
      search: "Search tables...",
      loading: "Loading tables...",
      no_tables: "No tables found for this connector",
      clear_selection: "Clear selection",
      no_match: 'No tables matching "{search}"',
    },

    matrix_entry: {
      new_agent: "New Agent",
      failed_to_create: "Failed to create draft agent.",
      build_failed: "Build failed to start. Check CLI configuration.",
    },

    workflow_upload: {
      build_hint: "Press Build to transform this workflow into a persona agent.",
      paste_placeholder: "Paste your workflow JSON here...",
      parse: "Parse",
      drop_file: "Drop a workflow file here",
      file_types: "n8n, Zapier, Make, or GitHub Actions (.json, .yaml)",
      paste_json: "Or paste JSON directly",
    },

    config_popup: {
      load_error: "Could not load saved values -- you may need to re-enter them.",
      fill_hint: "Fill in at least one field to save",
      failed_to_save: "Failed to save configuration",
    },

    onboarding: {
      setup_complete: "Setup {score}% complete",
      steps_done: "{completed}/{total} steps done",
      dismiss_checklist: "Dismiss checklist",
    },

    template_picker: {
      title: "Choose a Template",
      subtitle: "Pick a template to pre-fill your agent, or start from scratch.",
      start_from_scratch: "Start from scratch",
    },

    persona_overview: {
      no_match: "No personas match",
      no_connectors: "No connectors",
      never: "Never",
      description_copied: "Description copied to clipboard",
      failed_copy: "Failed to copy description",
      no_connectors_configured: "No connectors configured",
      click_to_copy: "Click to copy",
    },

    overview_empty: {
      title: "No personas match these filters",
      subtitle: "Try adjusting your search or filter chips, or reset the view to see all personas.",
      clear_all_filters: "Clear all filters",
    },

    overview_batch: {
      selected: "{count} selected",
    },

    overview_menu: {
      more_actions: "More actions",
      settings: "Settings",
    },

    overview_toolbar: {
      search_placeholder: "Search personas...",
      show_all: "Show all personas",
      show_favorites: "Show only favorites",
      favorites: "Favorites",
      clear_search: "Clear search",
    },

    overview_columns: {
      persona: "Persona",
      connectors: "Connectors",
      status: "Status",
      trust: "Trust",
      triggers: "Triggers",
      last_run: "Last Run",
      all_statuses: "All Statuses",
      active_only: "Active only",
      disabled_only: "Disabled only",
      building_drafts: "Building / Drafts",
      all_health: "All Health",
      all_connectors: "All Connectors",
      active_triggers: "{count} active trigger(s)",
    },

    health_indicator: {
      last: "last {count}",
    },

    view_presets: {
      views: "Views",
      save_current: "Save Current View",
      smart_presets: "Smart Presets",
      your_views: "Your Views",
      custom_view: "Custom View",
      custom_filters: "Custom filters",
      reset_defaults: "Reset to defaults",
      view_name_placeholder: "View name...",
      enter_view_name: "Enter a view name",
      delete_view: "Delete view",
      active_healthy: "Active & Healthy",
      needs_attention: "Needs Attention",
      failing_agents: "Failing Agents",
      my_favorites: "My Favorites",
      recently_active: "Recently Active",
    },

    activity: {
      title: "Activity",
      items: "{count} items",
      all_statuses: "All statuses",
      select_persona: "Select a persona to view activity",
      no_activity: "No activity yet",
      execution: "Execution",
      description: "Description",
      context: "Context",
      reviewer_notes: "Reviewer Notes",
      approve: "Approve",
      reject: "Reject",
      // ActivityList column headers
      col_activity: "Activity",
      col_status: "Status",
      col_time: "Time",
      // ActivityTab data titles
      execution_status: "Execution {status}",
      no_output: "No output",
      message_title: "Message",
      // ActivityModals
      modal_execution_title: "{name} - Execution",
      modal_execution_subtitle: "ID: {id}",
      modal_review_title: "Review: {title}",
      modal_review_subtitle: "Severity: {severity} \u00b7 Status: {status}",
    },

    chat: {
      select_persona: "Select a persona to start chatting",
      waiting: "Waiting for response...",
      ask_anything: "Ask anything about this agent...",
      enter_to_send: "Enter to send, Shift+Enter for new line",
      scroll_to_bottom: "Scroll to bottom",
      experiments_running_one: "{count} experiment running -- results will appear here when ready",
      experiments_running_other: "{count} experiments running -- results will appear here when ready",
      you: "You",
      assistant: "Assistant",
      thinking: "thinking...",
      copy_message: "Copy message",
      no_conversations: "No conversations yet",
      new_chat: "New Chat",
      confirm_delete: "Delete?",
      // ChatBubbles -- fallback for empty assistant content
      processing: "Processing...",
      delete_conversation: "Delete conversation",
      confirm_delete_conversation: "Confirm delete conversation",
    },

    advisory: {
      how_can_improve: "How can this agent work better for you?",
      go: "Go",
      // Advisory preset labels
      improve: "Improve",
      improve_desc: "Describe what you want this agent to do better",
      improve_goal_label: "What should improve?",
      experiment: "Experiment",
      experiment_desc: "Test two approaches side-by-side",
      experiment_hypothesis_label: "What to test?",
      analyze: "Analyze",
      analyze_desc: "Review performance trends and patterns",
      test_run: "Test Run",
      test_run_desc: "Run the agent and evaluate the result",
      test_input_label: "Test input (optional)",
    },

    ops: {
      sessions: "Sessions",
      run: "Run",
      lab: "Lab",
      health: "Health",
      assertions: "Assertions",
      switch_panel: "Switch to {panel} panel",
      // OpsLaunchpad preset labels
      choose_action: "Choose an action or type a message below",
      diagnose: "Diagnose",
      diagnose_desc: "Analyze health, performance and find issues",
      execute: "Execute",
      execute_desc: "Run the agent with optional input",
      input_optional: "Input (optional)",
      arena_test: "Arena Test",
      arena_test_desc: "Compare models head-to-head",
      models: "Models",
      improve: "Improve",
      improve_desc: "AI-driven persona refinement",
      focus_area: "Focus area",
      executions: "Executions",
      executions_desc: "Review recent execution history",
      knowledge: "Knowledge",
      knowledge_desc: "View memories and learned patterns",
      reviews: "Reviews",
      reviews_desc: "Pending approvals and decisions",
      versions: "Versions",
      versions_desc: "Prompt version history and rollback",
    },

    ops_run: {
      execute_agent: "Execute Agent",
      running: "Running...",
      recent: "Recent",
      no_executions: "No executions yet",
      refresh_executions: "Refresh executions",
    },

    ops_lab: {
      history: "History",
      no_lab_runs: "No lab runs yet",
      refresh_lab: "Refresh lab history",
      arena: "Arena",
      improve: "Improve",
    },

    ops_health: {
      no_health_data: "No health data",
      run_health_check: "Run Health Check",
      checking: "Checking...",
      last_check: "Last check",
      checked_at: "Checked {time}",
      issues: "Issues",
      run_check_aria: "Run health check",
      // Grade labels
      healthy: "Healthy",
      degraded: "Degraded",
      unhealthy: "Unhealthy",
    },

    ops_assertions: {
      active_count: "{enabled}/{total} active",
      no_assertions: "No assertions configured",
      refresh_assertions: "Refresh assertions",
      enable_assertion: "Enable {name}",
      disable_assertion: "Disable {name}",
    },

    health_tab: {
      title: "Health Check",
      description: "Run a dry-run analysis against this agent's current configuration to detect missing credentials, disconnected connectors, incompatible tool combinations, and underspecified use cases. Issues are surfaced as actionable cards with one-click fixes.",
    },

    matrix_tab: {
      loading: "Loading matrix",
      no_data: "No matrix data available. Build or rebuild this persona to generate dimensions.",
    },

    settings_status: {
      saving: "Saving {sections}...",
      changed: "{sections} changed",
      all_saved: "All changes saved",
      irreversible: "Irreversible",
      // PersonaSettingsTab labels
      identity: "Identity",
      execution: "Execution",
      label_name: "Name",
      label_description: "Description",
      label_icon: "Icon",
      label_color: "Color",
      max_concurrent: "Max Concurrent",
      timeout_sec: "Timeout (sec)",
      execution_retention: "Execution Retention",
      months: "months",
      persona_enabled: "Persona Enabled",
      sensitive_preview: "Sensitive Preview",
      sensitive_preview_desc: "Mask hover preview details until revealed.",
      failed_health_watch: "Failed to update health watch setting",
      health_watch: "Health Watch",
      health_watch_active: "Health monitoring active (every 6h)",
      health_watch_enable: "Enable continuous health monitoring",
    },

    tool_runner: {
      no_tools: "No tools assigned to this persona.",
      input_json: "Input JSON",
      run: "Run",
      running: "Running...",
      success: "Success",
      failed: "Failed",
      error: "Error",
    },

    // -- Health check panel (full-page health check) --
    health_check: {
      title: "Agent Health Check",
      idle_description: "Run a dry-run analysis to detect missing credentials, disconnected connectors, and underspecified use cases.",
      run_check: "Run Check",
      select_agent: "Select an agent to run health check",
      scanning: "Scanning agent configuration...",
      scanning_detail: "Checking credentials, connectors, and use cases",
      check_failed: "Health check failed",
      issues_found_one: "{count} issue found",
      issues_found_other: "{count} issues found",
      no_issues: "No issues detected",
      stale: "Stale",
      rerun: "Re-run",
      capabilities: "Capabilities",
      all_healthy: "All systems healthy",
      all_healthy_detail: "No issues detected in agent configuration",
    },

    // -- Health digest panel (multi-agent overview) --
    health_digest: {
      title: "Agent Health Digest",
      description: "Run a comprehensive health check across all your agents to detect configuration drift, expired credentials, and optimization opportunities.",
      run_digest: "Run Health Digest",
      generating: "Generating digest...",
      stale_warning: "Health data is outdated. Re-run for current results.",
      all_healthy: "All systems healthy",
      some_attention: "Some agents need attention",
      critical_issues: "Critical issues detected",
      agents_checked_one: "{count} agent checked",
      agents_checked_other: "{count} agents checked",
      issues_one: "{count} issue",
      issues_other: "{count} issues",
      last_run: "Last run: {time}",
    },

    // -- Health issue card --
    health_issue: {
      apply_fix: "Apply Fix: {label}",
      manual_action: "Manual action needed",
    },

    // -- Health score display --
    health_score: {
      healthy: "Healthy",
      degraded: "Degraded",
      unhealthy: "Unhealthy",
    },

    // -- Prompt editor --
    prompt_editor: {
      no_persona: "No persona selected",
      enter_content: "Enter {section} content...",
      new_section: "New Section",
      saved: "Saved",
      sections: "sections",
    },

    // -- Custom sections panel --
    custom_sections: {
      title: "Custom Sections",
      add: "Add",
      no_sections: "No custom sections yet",
      section_fallback: "Section {index}",
      remove_section: "Remove section",
      title_placeholder: "Section title...",
      content_placeholder: "Section content...",
      custom_section: "Custom Section",
    },

    // -- Activity filter tabs (labels for the filter bar) --
    activity_filters: {
      all: "All",
      executions: "Executions",
      events: "Events",
      memories: "Memories",
      reviews: "Reviews",
      messages: "Messages",
    },

    overview_actions: {
      delete_agent: "Delete Agent",
      delete_agent_message: "This agent and all its configuration will be permanently removed.",
      delete_agents: "Delete {count} Agent(s)",
      delete_agents_message: "{count} agent(s) and all their configuration will be permanently removed.",
      delete_drafts: "Delete {count} Draft(s)",
      delete_drafts_message: "{count} draft agent(s) will be permanently removed.",
    },

    persona_list: {
      all_personas: "All Personas",
      delete_drafts_btn: "Delete Drafts ({count})",
      badge_draft: "Draft",
      badge_disabled: "Disabled",
      badge_building: "Building",
      batch_selected: "{count} selected",
      batch_delete: "Delete",
      batch_clear: "Clear",
      no_personas_match: "No personas match",
      no_connectors: "No connectors",
      never: "Never",
      click_to_copy: "Click to copy",
      description_copied: "Description copied to clipboard",
      copy_failed: "Failed to copy description",
      no_match_filters: "No personas match these filters",
      adjust_filters_hint: "Try adjusting your search or filter chips, or reset the view to see all personas.",
      clear_all_filters: "Clear all filters",
      more_actions: "More actions",
      settings: "Settings",
      search_personas: "Search personas\u2026",
      favorites: "Favorites",
      show_all_personas: "Show all personas",
      show_only_favorites: "Show only favorites",
      clear_search: "Clear search",
      col_persona: "Persona",
      no_connectors_configured: "No connectors configured",
    },

    design_preview: {
      preview: "Preview",
      identity: "Identity",
      prompt: "Prompt",

      // (merged from duplicate block)
      lines: "{count} lines",
      tools: "Tools",
      triggers: "Triggers",
      subscriptions: "Subscriptions",
      none_yet: "None yet",
      activating: "Activating...",
      activate_agent: "Activate Agent",
      create_agent: "Create Agent",
      min_completeness: "Add more detail to reach 40% completeness",
    },

    // NOTE: model_config and use_cases subsections live earlier in this
    // agents section (search for "model_config:" and "use_cases:" above).
    // Duplicate blocks that were here have been removed.

    // -----------------------------------------------------------------
    //  EDITOR -- editor layout, tab bar, banners, header, stats
    // -----------------------------------------------------------------
    editor_ui: {

      // BudgetControls
      max_budget_label: "Max Budget (USD)",
      max_budget_hint: "Maximum total spend for a single execution. The run will stop if this limit is reached.",
      max_budget_range: "$0.01 and up, or leave blank for no limit",
      max_budget_example: "0.50",
      max_budget_placeholder: "Monthly budget in USD -- e.g. 25.00",
      max_turns_label: "Max Turns",
      max_turns_hint: "Maximum number of LLM round-trips per execution. Each turn is one prompt-response cycle with tool use.",
      max_turns_range: "1 and up, or leave blank for no limit",
      max_turns_example: "5",
      max_turns_placeholder: "Max round-trips -- e.g. 5",

      // PromptCacheControls
      prompt_caching: "Prompt Caching",
      prompt_caching_hint: "Caches the system prompt across executions to reduce input token costs. Agents that run frequently with the same prompt benefit most.",
      prompt_caching_range: "Off, 5 min, or 1 hr retention",
      prompt_caching_example: "5 min for cron-triggered agents",
      cache_off: "Off",
      cache_off_desc: "No caching",
      cache_short: "5 min",
      cache_short_desc: "Short retention",
      cache_long: "1 hr",
      cache_long_desc: "Long retention",

      // ConfigInheritanceBadge
      source_agent: "Agent",
      source_workspace: "Workspace",
      source_global: "Global",
      source_default: "Default",
      tooltip_workspace: "Inherited from workspace \"{name}\"",
      tooltip_global: "Inherited from global defaults",
      tooltip_agent_override: "Overrides workspace/global default",
      tooltip_agent_set: "Set on this agent",
      tooltip_default: "No value configured",
      tooltip_overriding: "Overriding inherited value",

      // EffectiveConfigPanel
      effective_config: "Effective Config",
      inherited: "inherited",
      overridden: "overridden",
      field_model: "Model",
      field_provider: "Provider",
      field_base_url: "Base URL",
      field_auth_token: "Auth Token",
      field_max_budget: "Max Budget",
      field_max_turns: "Max Turns",
      field_prompt_cache: "Prompt Cache",

      // CustomModelConfigForm
      provider: "Provider",
      provider_anthropic: "Anthropic",
      provider_ollama: "Ollama (local)",
      provider_litellm: "LiteLLM (proxy)",
      provider_custom: "Custom URL",
      model_name: "Model Name",
      model_name_placeholder_litellm: "e.g. anthropic/claude-sonnet-4-20250514",
      model_name_placeholder_ollama: "e.g. llama3.1:8b",
      model_name_placeholder_custom: "Model identifier",
      base_url: "Base URL",
      base_url_hint: "The API endpoint for your model provider. Must include protocol (http/https) and port if non-standard.",
      base_url_example: "http://localhost:11434",
      auth_token: "Auth Token",
      auth_token_hint: "Authentication token for the provider API. For Ollama local, use 'ollama'. For LiteLLM, use your master key.",
      auth_token_example: "sk-...",
      auth_token_placeholder_litellm: "LiteLLM master key (sk-...)",
      auth_token_placeholder_ollama: "ollama",
      auth_token_placeholder_custom: "Bearer token",

      // ProviderCredentialField + SaveConfigButton
      saved: "Saved",

      // LiteLLMConfigField
      litellm_label: "LiteLLM Proxy Settings",
      litellm_sublabel: "(global, shared across all agents)",
      litellm_base_url_placeholder: "Proxy Base URL (http://localhost:4000)",
      litellm_master_key_placeholder: "Master Key (sk-...)",
      litellm_save_label: "Save Global Config",
      litellm_description: "These global settings are used as defaults for all agents using the LiteLLM provider. Per-agent overrides above take precedence.",

      // OllamaApiKeyField
      ollama_label: "Ollama API Key",
      ollama_sublabel: "(global, shared across all personas)",
      ollama_placeholder: "Paste your key from ollama.com/settings",
      ollama_save_label: "Save Key",
      ollama_signup: "Sign up free at",
      ollama_copy_key: "and copy your API key from Settings.",

      // Compare (ModelABCompare)
      compare_models: "Compare Models",
      side_by_side: "Side-by-side",
      model_a: "Model A",
      model_b: "Model B",
      add_prompt_first: "Add a prompt first to run comparisons.",
      select_different_models: "Select two different models to compare.",
      run_comparison: "Run Comparison",
      generating_scenarios: "Generating scenarios...",
      testing_model: "Testing {modelId}",
      running: "Running...",

      tokens_in: "Tokens In",
      tokens_out: "Tokens Out",

      // ComparisonResults
      wins: "wins",
      composite: "composite",
      quality: "Quality",
      tool_accuracy: "Tool Accuracy",
      protocol: "Protocol",
      scenario: "Scenario",

      // CompareOutputPreviews
      output_previews: "Output Previews",
      no_output: "No output",
    },

    // -----------------------------------------------------------------
    //  USE CASES -- use case flows, detail, schedule, subscriptions
    // -----------------------------------------------------------------
    use_cases: {
      no_persona_selected: "No persona selected",
      use_cases_identified: "{count} use case identified",
      use_cases_identified_other: "{count} use cases identified",

      // DefaultModelSection
      persona_default_model: "Persona Default Model",
      inherit_hint: "All use cases inherit this model unless overridden below.",
      cache_5m: "Cache 5m",
      cache_1h: "Cache 1h",

      // UseCaseListPanel
      custom_model: "Custom model",
      notifications_configured: "Notifications configured",

      // UseCaseTabHeader / GeneralHistory
      general_history: "General History",
      unlinked_executions: "({count} unlinked execution)",
      unlinked_executions_other: "({count} unlinked executions)",
      no_unlinked_executions: "No unlinked executions found.",

      // UseCaseTestRunner
      test: "Test",
      run_with: "Run with",
      fixture_inputs: "Fixture inputs:",
      test_use_case: "Test Use Case",
      waiting_for_test: "Waiting for test to start...",
      cancel_test: "Cancel test",
      view_full_test_history: "View full test history",

      // UseCaseDetailPanel
      use_case_not_found: "Use case not found.",
      stop: "Stop",
      stop_test: "Stop test",
      no_prompt_configured: "No prompt configured",
      test_this_use_case: "Test this use case",
      tests: "Tests",
      view_full_test_history_title: "View full test history",
      stage_input: "Input",
      stage_transform: "Transform",
      stage_output: "Output",
      generating: "Generating...",
      testing: "Testing...",
      save_failed: "Save failed",

      // UseCaseDetailSections
      no_inputs: "No inputs",

      // UseCaseModelDropdown
      override: "Override",
      inherited_label: "Inherited",
      persona_default: "Persona Default",
      use_persona_default: "Use persona default",

      // UseCaseModelOverride
      model: "Model",
      default_label: "Default",
      not_set: "Not set",

      // UseCaseModelOverrideForm (labels shared with model_config)

      // UseCaseChannelDropdown (labels from channelSummary helper)

      // FixtureDropdownList
      confirm: "Confirm",
      update_fixture_title: "Update fixture with current inputs",
      delete_fixture_title: "Delete fixture",
      fixture_name_placeholder: "e.g. Happy Path",
      description_optional: "Description (optional)",
      save_current_as_fixture: "Save current as fixture",

      // UseCaseFixtureDropdown
      no_fixture: "No fixture",
      select_test_fixture: "Select test fixture",
      no_fixture_auto: "No fixture (auto-generate)",

      // UseCaseActiveItems
      active_triggers: "Active Triggers",
      active_subscriptions: "Active Subscriptions",
      confirm_delete: "Confirm?",

      // ScheduleBuilder
      quick_pick: "Quick Pick",
      visual: "Visual",
      cron: "Cron",
      activating: "Activating...",
      activate_schedule: "Activate Schedule Trigger",
      ai_suggestion: "AI suggestion:",

      // DayTimeGrid
      days: "Days",
      all: "All",
      weekdays: "Weekdays",
      time: "Time",
      hour_click: "Hour (click to set)",

      // ScheduleModePanels (cron field labels)
      cron_placeholder: "* * * * *  (min hour dom mon dow)",

      // SchedulePreview -- next label
      next: "next:",
      now: "now",

      // SubscriptionList
      schedule_trigger: "Schedule Trigger",
      activate: "Activate",

      event_type: "Event Type",
      select_event_type: "Select event type...",
      source_filter: "Source Filter",
      source_filter_optional: "(optional)",
      source_filter_placeholder: "e.g. persona-id or glob pattern",
      add: "Add",

      // UseCaseSubscriptions
      event_subscriptions: "Event Subscriptions",
      configured: "configured",
      activate_db: "Activate as DB-backed subscription",
      add_subscription: "Add Subscription",

      // UseCaseChannelDropdown
      select_channels_label: "Select notification channels",

      // ScheduleModePanels (cron field labels)
      cron_field_min: "min",
      cron_field_hour: "hour",
      cron_field_day: "day",
      cron_field_month: "month",
      cron_field_weekday: "weekday",
    },

    // -----------------------------------------------------------------
    //  EDITOR -- editor layout, tab bar, banners, header, stats
    // -----------------------------------------------------------------
    editor_ui: {
      // EditorBody
      select_agent: "Select an agent to get started",
      choose_from_sidebar: "Choose from the sidebar or create a new agent",
      save_failed_retry: "Save failed -- will retry on next edit",
      delete_failed: "Delete failed: {message}",

      // EditorTabBar
      tab_activity: "Activity",
      tab_matrix: "Matrix",
      tab_use_cases: "Use Cases",
      tab_lab: "Lab",
      tab_connectors: "Connectors",
      tab_chat: "Chat",
      tab_settings: "Settings",

      // EditorBanners
      unsaved_changes: "Unsaved changes",
      partial_load: "Partial load:",
      cloud_connect: "Connect a cloud orchestrator to run personas remotely",
      cloud_signin: "Sign in to unlock cloud features and remote execution",

      // PersonaEditorHeader
      execution_in_progress: "Execution in progress",
      running: "Running...",
      execute: "Execute",
      execute_failed: "Failed to start execution. Please try again.",
      no_triggers_or_subs: "No triggers or event subscriptions configured",
      missing_credentials: "Missing credentials: {credentials}",
      cannot_enable: "Cannot enable agent",

      // QuickStatsBar
      success: "Success",
      health: "Health",
      latency: "Latency",
      cost_per_run: "Cost/run",
      last_run: "Last run",
      rank: "Rank",
      view_in_leaderboard: "View in Leaderboard",
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
    // -- Database management (sub_databases/) -------------------------
    databases: {
      col_database: "Database",
      col_type: "Type",
      col_tables: "Tables",
      col_queries: "Queries",
      col_created: "Created",
      no_credentials: "No database credentials",
      no_credentials_hint: "Add database credentials from the Catalog to manage schemas and run queries.",
      no_matching: "No matching databases",
      no_matching_hint: "Try changing the type filter",
      all_types: "All Types ({count})",
      schema_manager: "Schema Manager",
      save_name: "Save name",
      rename_credential: "Rename credential",
      tab_tables: "Tables",
      tab_queries: "Queries",
      tab_console: "Console",
      tab_chat: "Chat",
      query_success: "Query executed successfully",
      no_rows: "No rows returned.",
      copied: "Copied",
      click_copy_column: "Click to copy column name: {name}",
      click_copy_cell: "Click to copy: {value}",
      row_count_one: "{count} row",
      row_count_other: "{count} rows",
      results_truncated: "Results truncated to 500 rows",
      generated_label: "Generated {language}",
      copy_sql: "Copy SQL",
      run_query: "Run Query",
      rerun_query: "Re-run Query",
      executing: "Executing...",
      placeholder_initial: 'e.g. "Show me all users who signed up last week"',
      placeholder_followup: "Ask a follow-up question...",
      generating_query: "Generating query...",
      ask_plain_english: "Ask in plain English",
      describe_query: "Describe what you want to query and I'll generate the {language} for you. You can review, edit, and execute the generated query.",
      query_generated: "Query generated.",
      query_failed: "Query generation failed.",
      cancelled: "Cancelled.",
      loading_columns: "Loading columns...",
      no_properties: "No properties found",
      no_columns: "No columns found",
      col_column: "Column",
      col_property: "Property",
      col_notion_type: "Notion Type",
      col_field_type: "Field Type",
      nullable: "Nullable",
      default_val: "Default",
      column_count_one: "{count} column",
      column_count_other: "{count} columns",
      property_count_one: "{count} property",
      property_count_other: "{count} properties",
      redis_hint: "Enter a Redis command and click Run",
      sql_hint: "Write a query and press Run or Ctrl+Enter",
      executing_query: "Executing query...",
      redis_placeholder: "Enter Redis command (e.g. GET mykey, HGETALL users:1)",
      convex_placeholder: 'Enter table name to browse, or JSON body: {"path": "func:name", "args": {}}',
      sql_placeholder: "Enter SQL query (Ctrl+Enter to execute)",
      running: "Running...",
      safe_mode: "Safe Mode",
      write_mode: "Write Mode",
      safe_mode_on: "Safe mode ON: write queries require confirmation",
      safe_mode_off: "Safe mode OFF: all queries execute directly",
      recent: "Recent:",
      modifies_data: "This query modifies data",
      modifies_data_hint: "The statement appears to be a write operation (INSERT, UPDATE, DELETE, DROP, etc.). Are you sure you want to execute it?",
      modifies_data_hint_short: "The statement appears to be a write operation. Are you sure you want to execute it?",
      execute_anyway: "Execute Anyway",
      select_or_create: "Select or create a query",
      new_query: "New Query",
      query_title_placeholder: "Query title",
      no_saved_queries: "No saved queries",
      saved: "Saved",
      saving: "Saving...",
      save: "Save",
      run: "Run",
      debugging: "Debugging...",
      ai_run: "AI Run",
      safe: "Safe",
      write: "Write",
      redis_run_hint: "Enter a Redis command and press Run or Ctrl+Enter",
      sql_run_hint: "Write a query and press Run or Ctrl+Enter",
      testing: "Testing...",
      test_connection: "Test Connection",
      copy_select_query: "Copy SELECT query",
      copy_table_name: "Copy table name",
      pin: "Pin",
      pinned: "Pinned",
      pin_table: "Pin this table",
      loading_key_info: "Loading key info...",
      type_label: "Type:",
      use_console_hint: "Use the Console tab to inspect this key's value.",
      select_db_hint: "Select a database to view its properties",
      select_table_hint: "Select a table to view its schema",
      select_key_hint: "Select a key to view its type",
      loading: "Loading...",
      no_databases_found: "No databases found",
      no_tables_found: "No tables found",
      no_matching_tables: "No matching tables",
      no_keys_found: "No keys found",
      no_matching_keys: "No matching keys",
      key_count_one: "{count} key",
      key_count_other: "{count} keys",
      database_count_one: "{count} database",
      database_count_other: "{count} databases",
      table_count_one: "{count} table",
      table_count_other: "{count} tables",
      filter_keys: "Filter keys...",
      filter_databases: "Filter databases...",
      filter_tables: "Filter tables...",
      refresh: "Refresh",
      introspection_unavailable: "Table introspection is not available for this connector type.",
    },
    // -- Dependencies / blast radius (sub_dependencies/) ---------------
    dependencies: {
      simulate_revocation: "Simulate Revocation",
      blast_radius: "Blast Radius",
      impact_high: "Removing this credential would impact {count} agents. Consider rotating instead of deleting.",
      impact_medium: "This credential is used by {count} agent(s). Review dependencies before changes.",
      impact_low: "No agents depend on this credential. Safe to modify or remove.",
      affected_agents: "Affected Agents",
      affected_events: "Affected Events",
      no_credentials_graph: "No credentials to graph",
      no_credentials_graph_hint: "Add credentials to visualize their relationships and dependencies.",
      no_credential_selected: "No credential selected",
      no_credential_selected_hint: "Select a credential to see its blast radius and dependencies.",
      credentials_label: "Credentials ({count})",
      relationships: "Relationships ({count})",
      more_relationships: "+{count} more",
      kind_credentials: "Credentials",
      kind_agents: "Agents",
      kind_events: "Events",
      severity_low: "Low Risk",
      severity_medium: "Medium Risk",
      severity_high: "High Risk",
      severity_critical: "Critical",
      not_tested: "Not tested",
      healthy: "Healthy",
      unhealthy: "Unhealthy",
      dep_count_one: "{count} dep",
      dep_count_other: "{count} deps",
      connection_count_one: "{count} connection",
      connection_count_other: "{count} connections",
      personas_would_stop: "Personas That Would Stop ({count})",
      workflows_would_break: "Workflows That Would Break ({count})",
      nodes_broken: "{broken}/{total} nodes broken",
      failover_credentials: "Failover Credentials ({count})",
      suggested_mitigations: "Suggested Mitigations",
      mitigation_failover: "Switch affected personas to a healthy failover credential",
      mitigation_pause: "Pause affected workflows before revoking",
      mitigation_schedule: "Schedule revocation during low-traffic hours",
      mitigation_create: "Create a replacement credential for {serviceType} before revoking",
      revocation_simulation: "Revocation Simulation",
      personas_affected: "Personas Affected",
      workflows_broken: "Workflows Broken",
      daily_execs_lost: "Daily Execs Lost",
      daily_cost_impact: "Daily Cost Impact",
      sim_low: "No personas or workflows depend on this credential. Safe to revoke.",
    },
    // -- Shared vault components (shared/) ----------------------------
    shared: {
      add: "Add",
      no_connector_available: "No connector definition available for this credential type.",
      request_builder: "Request Builder",
      close: "Close",
      response: "Response",
      truncated_warning: "Response body was truncated (exceeded 2 MB limit). Partial content is shown below.",
      no_endpoints: "No API endpoints loaded",
      no_endpoints_hint: "Upload an OpenAPI/Swagger spec to explore and test API endpoints.",
      upload_spec: "Upload Spec File",
      paste_openapi: "Paste OpenAPI",
      paste_spec_title: "Paste OpenAPI / Swagger Spec",
      paste_spec_placeholder: "Paste your OpenAPI JSON or YAML spec here...",
      parsing: "Parsing...",
      parse_and_load: "Parse & Load",
      loading_api: "Loading API explorer",
      example_endpoints_one: "{count} example endpoint",
      example_endpoints_other: "{count} example endpoints",
      filter: "Filter...",
      stop: "Stop",
      run_all: "Run All",
      no_endpoints_match: 'No endpoints match "{search}"',
      no_endpoints_match_hint: "Try a different search term or clear your filter.",
      loading_recipes: "Loading recipes",
      recipes: "Recipes",
      recipes_subtitle: "Reusable automation templates for this credential",
      new_recipe: "New Recipe",
      no_recipes: "No recipes yet",
      no_recipes_hint: "Create your first recipe by describing what you want to automate with this credential.",
      create_first_recipe: "Create First Recipe",
      failed_delete_recipe: "Failed to delete recipe",
      create_recipe: "Create Recipe",
      recipe_what: "What should this recipe do?",
      recipe_placeholder: "e.g., List all open pull requests for a repository and summarize the changes...",
      generate_with_ai: "Generate with AI",
      starting: "Starting...",
      generated_recipe: "Generated Recipe",
      name_label: "Name",
      description_label: "Description",
      prompt_template: "Prompt Template",
      example_result: "Example Result",
      accept_save: "Accept & Save",
      regenerate: "Regenerate",
      open_settings: "Open settings",
      created_label: "Created:",
      updated_label: "Updated:",
      recent_activity: "Recent Activity",
      no_recorded_activity: "No recorded activity yet",
      mcp_tools_label: "MCP Tools",
      discovering: "Discovering...",
      discover_tools: "Discover Tools",
      discover_mcp: "Discover MCP server tools",
      discover_mcp_hint: "Connect to the MCP server to discover available tools and test them.",
      input_schema: "Input Schema",
      no_input_params: "This tool takes no input parameters.",
      test_tool: "Test Tool",
      execute_tool: "Execute Tool",
      running_tool: "Running...",
      no_tools_found: "No tools found on this MCP server",
      no_tools_hint: "The server responded but reported no available tools.",
      test_connection: "Test Connection",
      edit_fields: "Edit Fields",
      failed_update: "Failed to update credential",
      delete_credential_confirm: "Delete this credential?",
      confirm: "Confirm",
      delete_credential: "Delete credential",
      services: "Services ({count})",
      events: "Events ({count})",
      vector_kb: "Vector Knowledge Base",
      kb_not_found: "Knowledge base not found",
      scan_directory: "Scan Directory",
      directory_path: "Directory Path",
      no_directory: "No directory selected",
      browsing: "Browsing...",
      browse: "Browse",
      file_patterns: "File Patterns",
      file_patterns_hint: "(empty = all supported)",
      scan_ingest: "Scan & Ingest",
      scanning: "Scanning...",
      drop_to_ingest: "Drop files to ingest",
      drop_supported: "Supported: txt, md, html, csv, json, yaml, code files",
      starting_ingestion: "Starting ingestion...",
      preparing_ingestion: "Preparing ingestion...",
      ingestion_failed: "Ingestion failed",
      ingestion_done: "Done! {chunks} chunks from {docs} files",
      processing_file: "Processing: {file}",
      processing: "Processing...",
      file_progress: "{done}/{total} files",
      paste_text: "Paste Text",
      title_label: "Title",
      title_placeholder: "e.g. Product Requirements, Meeting Notes...",
      content_label: "Content",
      content_placeholder: "Paste your text content here...",
      ingest: "Ingest",
      ingesting: "Ingesting...",
      show_full_chunk: "Show full chunk",
      show_less: "Show less",
      browse_files: "Browse Files",
      directory: "Directory",
      search_kb: "Search your knowledge base",
      search_kb_hint: "Use natural language to find relevant content across your documents.",
      search_placeholder: "Ask a question or describe what you're looking for...",
      search: "Search",
      results_label: "Results:",
      press_enter: "Press Enter to search",
      no_results: "No results found",
      no_results_hint: "Try rephrasing your query or using different keywords.",
      kb_info: "Knowledge Base Info",
      statistics: "Statistics",
      local_embedding: "Local Embedding",
      label_id: "ID",
      label_status: "Status",
      label_embedding_model: "Embedding Model",
      label_dimensions: "Dimensions",
      label_chunk_size: "Chunk Size",
      label_chunk_overlap: "Chunk Overlap",
      label_created: "Created",
      label_updated: "Updated",
      label_documents: "Documents",
      label_chunks: "Chunks",
      status_indexed: "indexed",
      status_error: "error",
      save_name: "Save name",
      rename_credential: "Rename credential",
    },
    // Credential manager header / toolbar
    manager: {
      title: "Credentials",
      // {count} = number of stored credentials
      credentials_stored_one: "{count} credential stored",
      credentials_stored_other: "{count} credentials stored",
      search_catalog: "Search catalog...",
      search_credentials: "Search credentials...",
      clear_search: "Clear search",
      loading_credentials: "Loading credentials",
      // Rotate all
      no_rotation_support: "No credentials support automatic rotation",
      refresh_oauth_one: "Refresh {count} OAuth credential",
      refresh_oauth_other: "Refresh {count} OAuth credentials",
      refreshing: "Refreshing...",
      rotate_count: "Rotate ({count})",
      rotate: "Rotate",
      cancel_healthcheck: "Cancel healthcheck",
      test_all_credentials: "Test all credentials",
      test_all: "Test All",
      daily_progress: "Daily {done}/{total}",
      testing_progress: "Testing {done}/{total}",
    },
    // Bulk healthcheck summary panel
    bulk_healthcheck: {
      title: "Healthcheck Results",
      needs_attention: "Needs Attention",
      slowest_responses: "Slowest Responses",
    },
    // Health status bar
    health_bar: {
      healthy: "healthy",
      needs_attention: "needs attention",
      untested: "untested",
    },
    // Vault breadcrumb
    breadcrumb: {
      aria_label: "Vault breadcrumb",
    },
    // Credential card
    credential_card: {
      deleting: "Deleting {name}...",
      no_connector: "No connector definition available for this credential type.",
      stored_result: "Stored connection test result",
      delete_credential: "Delete credential",
      corrupted: "Corrupted",
      corrupted_tooltip: "Healthcheck ring buffer metadata is corrupted. Anomaly scores are unavailable until the next successful healthcheck overwrites the bad data.",
      field_count_one: "{count} field",
      field_count_other: "{count} fields",
      add_tag_placeholder: "Add tag...",
      add_tag_button: "Add tag",
      remove_tag: "Remove tag \"{tag}\"",
      copy_credential_id: "Copy credential ID",
      refresh_oauth: "Refresh OAuth token now",
      refresh: "Refresh",
    },
    // Vault status badge
    vault_badge: {
      needs_attention: "Needs attention",
      secure: "Secure",
      unencrypted: "{count} unencrypted",
      encrypted: "Encrypted",
      encrypted_fallback: "Encrypted (fallback key)",
      vault_needs_attention: "Vault needs attention",
      vault_secure: "Vault is secure",
      aes_title: "AES-256-GCM encryption",
      aes_detail: "Each credential is encrypted with a unique random nonce, producing tamper-proof ciphertext that only this app can decrypt.",
      keychain_title: "Master key in OS Keychain",
      fallback_key_title: "Fallback master key",
      keychain_detail: "Your master encryption key is stored in the Windows Credential Manager (or macOS Keychain), protected by your OS login.",
      fallback_key_detail: "The OS keychain was unavailable, so the master key is derived from your machine identity. Credentials are still encrypted, but OS-level key storage is preferred.",
      local_title: "Credentials never leave this device",
      local_detail: "All secrets are stored in a local SQLite database. Nothing is sent to any server or cloud.",
      encrypting: "Encrypting...",
      encrypt_now_one: "Encrypt {count} unencrypted credential now",
      encrypt_now_other: "Encrypt {count} unencrypted credentials now",
      encrypt_done_one: "Done -- {migrated} credential encrypted.",
      encrypt_done_other: "Done -- {migrated} credentials encrypted.",
      encrypt_partial: "Encrypted {migrated}, failed {failed}. Try again or restart the app.",
    },
    // Credential delete dialog
    delete_dialog: {
      title: "Delete Credential",
      cannot_undo: "This action cannot be undone.",
      label_name: "Name",
      label_type: "Type",
      unverified_warning: "Could not verify all dependencies. Some connected agents or automations may not be shown.",
    },
    // Credential card body (OAuth)
    card_body: {
      failed_update: "Failed to update credential",
      authorizing_with: "Authorizing with {name}...",
      authorize_with: "Authorize with {name}",
      authorize_hint: "Launches app-managed {name} consent and updates refresh token after approval.",
      consent_completed: "{name} consent completed at {time}",
    },
    // Card details tabs
    card_details: {
      tab_intelligence: "Intelligence",
      tab_rotation: "Rotation",
      tab_token_lifetime: "Token Lifetime",
      tab_services: "Services ({count})",
      tab_events: "Events ({count})",
      tab_audit: "Audit",
    },
    // Intelligence tab
    intelligence_tab: {
      loading: "Loading intelligence data",
      tab_overview: "Overview",
      tab_dependents: "Dependents ({count})",
      tab_audit_log: "Audit Log ({count})",
      total_accesses: "Total Accesses",
      distinct_personas: "Distinct Personas",
      last_24h: "Last 24h",
      last_7d: "Last 7 Days",
      no_usage: "No recorded usage. This credential may be unused.",
      last_accessed_days: "Last accessed {days} days ago. Consider reviewing if still needed.",
      first_accessed: "First accessed: {timestamp}",
      last_accessed: "Last accessed: {timestamp}",
      no_dependents: "No known dependents",
      no_dependents_hint: "Changes to this credential are low-risk.",
      dependents_warning_one: "Changing or deleting this credential will affect {count} persona:",
      dependents_warning_other: "Changing or deleting this credential will affect {count} personas:",
      link_structural: "structural",
      link_observed: "observed",
      via_connector: "via {connector}",
    },
    // OAuth token metrics
    token_metrics: {
      loading: "Loading metrics...",
      no_metrics: "No token refresh metrics recorded yet. Metrics will appear after the first OAuth token refresh.",
      trend_warning: "Token lifetime is trending shorter \u2014 possible provider throttling or policy change.",
      total_refreshes: "Total Refreshes",
      failure_rate: "Failure Rate",
      avg_lifetime: "Avg Lifetime",
      avg_drift: "Avg Drift",
      recent_ttls: "Recent provider TTLs (newest first)",
      recent_refreshes: "Recent refreshes",
    },
    // Rotation section
    rotation_section: {
      corrupted_warning: "Healthcheck metadata is corrupted. Anomaly scores are unavailable until the next successful healthcheck overwrites the bad data.",
      anomaly_warning: "Anomaly detected: credential suddenly failing after previous success. Possible revocation.",
      history: "History",
      oauth_refresh_active: "OAuth token refresh active",
      oauth_refresh_active_auto: "OAuth token refresh active (auto)",
      auto_rotation_active: "Auto-rotation active",
      rotation_paused: "Rotation paused",
      rotate_now: "Rotate Now",
      rotation_failed: "Rotation failed: {error}",
      remove_policy_failed: "Failed to remove policy: {error}",
      remove_policy_tooltip: "Remove rotation policy",
      rotate_every: "Rotate every",
      days: "days",
      update_period_failed: "Failed to update rotation period: {error}",
      no_policy: "No rotation policy configured.",
      enabling: "Enabling...",
      enable_rotation: "Enable Rotation",
      enable_failed: "Failed to enable rotation: {error}",
    },
    // Event config
    event_config: {
      event_triggers: "Event Triggers",
      scheduled_rotation: "Scheduled Rotation",
      scheduled_rotation_desc: "Rotate credentials on a cron schedule (e.g., daily, weekly).",
      expiration_threshold: "Expiration Threshold",
      expiration_threshold_desc: "Trigger rotation when credential approaches its expiry date.",
      healthcheck_failure: "Healthcheck Failure",
      healthcheck_failure_desc: "Automatically rotate when the credential fails its healthcheck.",
      cron_schedule: "Cron schedule",
      cron_daily: "Daily (midnight)",
      cron_weekly: "Weekly (Mon)",
      cron_monthly: "Monthly (1st)",
      cron_6h: "Every 6 hours",
      rotate_when_expiring: "Rotate when expiring within",
      expiration_hint: "Credential must have an expires_at field in its metadata.",
      polling_interval: "Polling interval",
      checks_per_day: "Approx. {count} checks/day",
      seconds_10: "10 seconds",
      seconds_30: "30 seconds",
      minute_1: "1 minute",
      minutes_2: "2 minutes",
      minutes_5: "5 minutes",
      minutes_10: "10 minutes",
    },
    // Credential forms
    credential_forms: {
      encrypted_keychain: "Encrypted with OS Keychain",
      encrypted_at_rest: "Encrypted at rest",
      copy_value: "Copy value",
      paste_from_clipboard: "Paste from clipboard",
      get_credentials: "Get your credentials",
      how_to_get_credentials: "How to get credentials",
      healthcheck_required: "Run a successful connection test before saving.",
      back_to_catalog: "Back to catalog",
      new_credential: "New {label} Credential",
      configure_fields: "Configure credential fields",
      oauth_required: "Use the authorize button below to connect this credential.",
    },
    // Audit log
    audit_log: {
      empty: "No audit entries yet",
      empty_hint: "Operations will be logged as they occur.",
      access_events_hint: "Access events will appear here.",
    },
    // Import flow
    credential_import: {
      import_from: "Import from {source}",
      import_from_vault: "Import from External Vault",
      import_subtitle: "Choose the source of your secrets",
      enable_sync: "Enable sync mode",
      source_ref: "Source reference",
      poll_interval: "Poll interval",
    },
    // Empty state
    empty_state: {
      heading: "Connect your first service",
      description: "Choose how you want to add a credential",
      catalog_heading: "Add from catalog",
      catalog_description: "Pick a known service like Slack, GitHub, or OpenAI. Pre-configured fields and healthchecks.",
      ai_heading: "AI-designed credential",
      ai_description: "Describe any service and AI will configure the fields, auth type, and healthcheck for you.",
      works_with_any: "Works with any API",
    },
    // Credential list
    credential_list: {
      no_match: "No credentials match",
      no_match_hint: "Try adjusting your filters or search term",
    },
    // Wizard detect
    wizard_detect: {
      no_services: "No services match \"{search}\"",
      select_services: "Select services to add credentials for, or scan to auto-detect.",
      scanning: "Scanning CLI tools and browser sessions...",
      scan_button: "Scan for authenticated services",
      search_services: "Search services...",
      desktop_bridge: "Desktop bridge -- auto-detected",
      batch_complete: "Batch setup complete",
      skip_service: "Skip this service",
      no_filter_match: "Try a different search term or clear your filter.",
    },
    // Autopilot (OpenAPI)
    autopilot: {
      title: "API Autopilot",
      input_hint: "Paste an OpenAPI spec URL or content to auto-generate a connector",
      preview_hint: "Review the parsed API and select which endpoints to include",
      generated_hint: "Your connector has been generated successfully",
      connector_generated: "Connector Generated Successfully",
      api_playground: "API Playground",
      api_playground_hint: "Test your generated API tools before using them",
      paste_spec: "Paste OpenAPI Spec (JSON or YAML)",
      valid_url_error: "Enter a valid URL (e.g. https://api.example.com/openapi.json)",
      authentication: "Authentication",
      connector_name: "Connector Name",
      color: "Color",
      endpoints_selected: "Endpoints ({selected}/{total} selected)",
      generating: "Generating...",
      generate_connector: "Generate Connector ({count} tools)",
      base_url: "Base URL",
      headers_label: "Headers",
      header_name_placeholder: "Header name",
      query_parameters: "Query Parameters",
      param_name_placeholder: "Param name",
      request_body: "Request Body (JSON)",
    },
    // Foraging (auto-discover)
    foraging: {
      no_credentials_found: "No credentials found",
      no_credentials_hint: "Try setting environment variables like OPENAI_API_KEY or configure ~/.aws/credentials.",
      scan_description: "Scan your filesystem for existing credentials -- AWS profiles, environment variables, .env files, Docker configs, SSH keys, and more. Discovered credentials can be imported into your vault with one click.",
      scan_locations: "Scans: ~/.aws, ~/.kube, env vars, .env, ~/.npmrc, Docker, GitHub CLI, SSH",
      scan_privacy: "No secrets are uploaded -- scanning happens entirely on your machine.",
      scanning: "Scanning filesystem for credentials...",
      scan_failed: "Scan Failed",
    },
    // Desktop discovery
    desktop_discovery: {
      title: "Desktop Apps",
      allowed_binaries: "Allowed binaries: ",
    },
    // Picker
    picker_section: {
      no_connectors: "No connectors found",
      no_connectors_hint: "Try adjusting your filters or search term.",
      how_to_get: "How to get {label} {authLabel}",
      required_fields: "Required fields:",
      filter_status: "Status",
      filter_purpose: "Purpose",
      filter_category: "Category",
      filter_license: "License",
    },
    // Schema configs
    schemas: {
      none_configured: "None configured.",
      required_badge: "REQ",
    },
    // Design modal phases
    design_phases: {
      saving: "Saving credential...",
      credential_created: "Credential Created",
      step_connecting: "Connecting",
      step_connecting_desc: "Establishing connection to AI",
      step_analyzing: "Analyzing requirements",
      step_analyzing_desc: "Identifying authentication patterns",
      step_designing: "Designing connector",
      step_designing_desc: "Generating fields and validation rules",
      step_healthcheck: "Generating healthcheck",
      step_healthcheck_desc: "Building test endpoint configuration",
      typical_time: "Typically 15--30 seconds",
      saved_catalog: "Saved local catalog",
      search_catalog: "Search catalog",
      no_catalog: "No catalog entries yet. Save a successfully tested connector first.",
      existing_connector: "Existing connector found: ",
      new_connector: "New connector discovered ",
      auto_provision: "Auto-provision available",
      verified_setup: "Verified setup",
      cached_recipe: "Cached recipe will speed up design",
      open_setup_page: "Open setup page in browser",
      mark_not_done: "Mark as not done",
      mark_done: "Mark as done",
      mark_step_complete: "Mark step complete",
      copy_to_clipboard: "Copy to clipboard",
    },
    // Auto-cred extra strings
    auto_cred_extra: {
      preparing_guided: "Preparing guided setup instructions...",
      starting_browser: "Starting browser session...",
      no_log_output: "No log output captured.",
      credential_saved: "Credential Saved",
      saving_connector: "Saving credential & connector...",
      partial_extraction: "Partial Extraction",
      partial_hint: "Some fields could not be filled automatically. Please complete the missing fields manually before saving.",
      credential_name: "Credential Name",
      do_not_interact: "Do not interact with the browser.",
      auto_setup_label: "Auto-Setup {label}",
      analyzing_setup: "Analyzing connector setup procedures...",
      browser_hint: "Browser automation will guide credential creation",
      guided_badge: "Guided",
      playwright_badge: "Playwright MCP",
      invalid_url: "Please enter a valid URL starting with http:// or https://",
      playwright_available: "Playwright browser automation available",
      guided_mode: "Guided mode (no browser automation)",
      all_fields_captured: "All {count} fields captured",
      partial_badge: "Partial",
      test_to_save: "Test connection to enable save",
      save_procedure_title: "Save browser procedure for this connector (dev)",
      copied: "Copied",
      copy_log: "Copy Log",
      step_browser_navigate: "Navigate to token/key creation form",
      step_guided_instructions: "Claude provides step-by-step instructions",
      step_browser_extract: "Extract generated credential values",
      step_guided_extract: "Claude extracts the values from its instructions",
      step_browser_review: "Return here for your review before saving",
      step_guided_review: "Review and save the credential",
      setup_context: "Setup context from design analysis:",
    },
    // Negotiator extra strings
    negotiator_extra: {
      checking_auth: "Checking existing authentications...",
      auto_provisioning: "Automated API key provisioning",
      generating_plan: "Generating provisioning plan...",
      detecting_auth: "Detecting existing auth...",
      start_auto: "Start auto-provisioning",
      need_help: "Need help with this step?",
      hide_help: "Hide help",
      ask_question: "Ask a question about this step...",
    },
    // Workspace connect panel
    workspace_panel: {
      select_services: "Select services to connect",
      browser_sign_in: "Complete sign-in in your browser...",
      creating_credentials: "Creating credentials...",
      all_created: "All credentials created",
      some_failed: "Some credentials failed",
    },
    // Gateway members modal
    gateway: {
      gateway_members: "{name} \u2014 gateway members",
      gateway_description: "Bundle multiple MCP credentials under this gateway. Attached personas inherit every enabled member's tools, namespaced as <display_name>::<tool>.",
      loading_members: "Loading members\u2026",
      current_members: "Current members ({count})",
      no_members: "No members yet. Add one below to start bundling tools.",
      disabled_suffix: " \u00b7 disabled",
      add_member_heading: "Add a member",
      no_eligible: "No eligible credentials. Add an MCP credential first in the credentials list.",
      credential_label: "Credential",
      pick_credential: "Pick a credential\u2026",
      pick_error: "Pick a credential and give it a short display name",
      display_name: "Display name (tool prefix)",
      display_name_placeholder: "e.g. arcade, research_tools, docs",
      adding: "Adding\u2026",
      add_member: "Add member",
    },
    // Pending auth modal
    pending_auth: {
      title: "Authorization required",
      tool_needs_consent: "The tool {tool} needs fresh OAuth consent before it can be invoked.",
      auth_url_label: "Authorization URL",
      step_1: "Click Open authorization URL to grant consent in your browser.",
      step_2: "Complete the consent flow for the requested scopes.",
      step_3: "Return here and click I've authorized \u2014 retry.",
      reopen_url: "Re-open URL",
      open_auth_url: "Open authorization URL",
      open_first: "Open the URL and grant consent first",
      retrying: "Retrying\u2026",
      retry_authorized: "I've authorized \u2014 retry",
      retry_failed: "Retry failed",
    },
    // Rotation insight badge tooltip
    rotation_insight: {
      perm_errors: "Permanent errors detected -- rotation attempted, alerting.",
      degrading: "Sustained degradation -- pre-emptive rotation triggered.",
      backoff: "Transient failures -- exponential backoff active.",
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

    // -- Unified Deployment Dashboard --
    dashboard: {
      title: "Deployments",
      subtitle: "All deployments across Cloud and GitLab",
      refresh: "Refresh",
      // Summary card labels
      total: "Total",
      active: "Active",
      paused: "Paused",
      cloud: "Cloud",
      gitlab: "GitLab",
      // Table column headers
      col_name: "Name",
      col_target: "Target",
      col_status: "Status",
      col_invocations: "Invocations",
      col_health: "Health (7d)",
      col_last_activity: "Last Activity",
      col_created: "Created",
      col_actions: "Actions",
      // Empty states
      no_targets_title: "No deployment targets connected",
      no_targets_hint: "Connect to Cloud Execution or GitLab in the respective tabs to see deployments here.",
      no_match_filters: "No deployments match filters",
      no_deployments: "No deployments yet",
      adjust_filters: "Try adjusting your search or filters.",
      deploy_hint: "Deploy personas from the Cloud or GitLab tabs.",
      // Footer -- {showing}, {total}
      showing_of: "Showing {showing} of {total} deployment{plural}",
      total_invocations: "Total invocations:",
      // Filter
      search_placeholder: "Search deployments...",
      filter: "Filter",
      filter_target: "Target",
      filter_status: "Status",
      filter_all: "All",
      // Bulk actions -- {count}
      bulk_selected: "{count} selected",
      bulk_pause: "Pause ({count})",
      bulk_resume: "Resume ({count})",
      bulk_delete_confirm: "Delete {count}?",
      bulk_delete: "Delete ({count})",
      clear_selection: "Clear selection",
      // Test
      test_deployment: "Test deployment",
      // Action titles
      action_pause: "Pause",
      action_resume: "Resume",
      action_undeploy: "Undeploy",
      open_gitlab: "Open in GitLab",
      open_endpoint: "Open endpoint",
      // Health sparkline labels
      no_data: "No data",
      success_rate: "Success rate",
      volume: "Volume",
      errors: "Errors",
      // Execution progress stage labels
      stage_initializing: "Initializing",
      stage_thinking: "Thinking",
      stage_tool_calling: "Tool Call",
      stage_processing_result: "Processing Result",
      stage_generating: "Generating",
      stage_completed: "Completed",
      stage_failed: "Failed",
      tool_calls: "{count} tool calls",
    },
  },

  // -------------------------------------------------------------------
  //  SHARING -- network, bundles, enclaves, peers, identity
  // -------------------------------------------------------------------
  sharing: {
    // -- BundleExportDialog --
    export_title: "Export Bundle",
    export_subtitle: "Select exposed resources to include in the signed .persona bundle.",
    seal_enclave_title: "Seal Enclave",
    seal_enclave_subtitle: "Create a cryptographically sealed persona enclave with execution constraints.",
    mode_bundle: "Bundle",
    mode_enclave: "Enclave",
    no_resources_exposed: "No resources are exposed. Expose resources first in the Network settings.",
    select_all: "Select all",
    deselect_all: "Deselect all",
    // {selected}, {total} count of resources
    selected_of_total: "{selected} of {total} selected",
    cancel: "Cancel",
    share_link: "Share Link",
    creating_link: "Creating...",
    link_copied: "Link Copied!",
    copy_to_clipboard: "Copy to Clipboard",
    copying: "Copying...",
    copied: "Copied!",
    export_to_file: "Export to File",
    exporting: "Exporting...",
    seal_enclave_btn: "Seal Enclave",
    sealing: "Sealing...",
    // Enclave config panel
    enclave_info: "Enclaves are cryptographically sealed and signed with your identity. The recipient can verify authenticity but cannot modify the persona or extract credentials.",
    label_persona: "Persona",
    select_persona_placeholder: "Select a persona...",
    label_max_cost: "Max cost (USD)",
    label_max_turns: "Max turns",
    label_allow_persistence: "Allow enclave to persist data on host",

    // -- BundleImportDialog --
    import_title: "Import Bundle",
    import_subtitle: "Import a signed .persona bundle from a trusted peer.",
    verify_enclave_title: "Verify Enclave",
    verify_enclave_subtitle: "Verify a sealed persona enclave from a trusted creator.",
    choose_file: "Choose file",
    paste_from_clipboard: "Paste from Clipboard",
    share_link_placeholder: "Paste share link or personas:// URL...",
    open: "Open",
    import_pick_hint: "Choose a file, paste clipboard data, or use a share link (personas:// deep link) from another Personas instance.",
    verifying_enclave: "Verifying enclave...",
    verifying_bundle: "Verifying bundle...",
    importing_resources: "Importing resources...",
    close: "Close",
    import_btn: "Import",
    import_anyway: "Import Anyway",
    clipboard_empty: "Clipboard is empty",

    // -- BundlePreviewContent --
    signature_verified: "Signature verified",
    signature_mismatch: "Signature mismatch",
    unverified_signature: "Unverified signature",
    trusted_peer: "Trusted peer",
    unknown_peer: "Unknown peer",
    // {count} resources
    resources_in_bundle: "{count} resource{plural} in bundle",
    conflict: "conflict",
    naming_conflicts_detected: "Naming conflicts detected",
    skip_conflicting: "Skip conflicting resources",
    rename_prefix_label: "Rename prefix",
    rename_prefix_placeholder: "e.g. imported-",
    danger_trusted_title: "Signature does not match the trusted key for this peer.",
    danger_trusted_body: "The bundle claims to be from a known peer but the signature verification failed. This could indicate tampering. Only proceed if you are certain the source is safe.",
    danger_trusted_confirm: "I understand the risks and want to import this bundle",
    danger_unknown_title: "This bundle is from an unknown signer and cannot be verified.",
    danger_unknown_body: "The signer is not in your trusted peers list, so the signature cannot be checked against a known key. Add the sender as a trusted peer first, or proceed only if you fully trust the source.",
    danger_unknown_confirm: "I understand the risks and want to import this unverified bundle",

    // -- EnclaveVerificationView --
    signature_valid: "Signature valid",
    invalid_signature: "Invalid signature",
    content_intact: "Content intact",
    content_tampered: "Content tampered",
    trusted_creator: "Trusted creator",
    unknown_creator: "Unknown creator",
    creator_identity: "Creator Identity",
    execution_policy: "Execution Policy",
    max_cost_label: "Max cost:",
    max_turns_label: "Max turns:",
    persistence_label: "Persistence:",
    persistence_allowed: "Allowed",
    persistence_denied: "Denied",
    capabilities_label: "Capabilities:",
    capabilities_none: "None",

    // -- ExposureManager --
    network_sharing_title: "Network & Sharing",
    network_sharing_subtitle: "Manage your identity, trusted peers, and shared resources",
    exposed_resources: "Exposed Resources",
    expose_resource: "Expose Resource",
    loading_exposed: "Loading exposed resources...",
    no_resources_hint: "No resources exposed yet. Expose personas or other resources to include them in bundles for sharing.",
    // AddExposureForm
    resource_type_label: "Resource Type",
    access_level_label: "Access Level",
    resource_label: "Resource",
    resource_id_placeholder: "Resource ID",
    tags_label: "Tags (comma-separated, optional)",
    tags_placeholder: "e.g. automation, devops",
    // {count} fields exposed
    fields_exposed: "{count} field{plural} exposed",

    // -- IdentitySettings --
    your_identity: "Your Identity",
    peer_id_label: "Peer ID",
    copy_identity_card: "Copy Identity Card",
    display_name_label: "Display Name",
    save: "Save",
    edit: "Edit",
    loading_identity: "Loading identity...",
    trusted_peers: "Trusted Peers",
    add_peer: "Add Peer",
    paste_identity_card: "Paste identity card",
    paste_card_placeholder: "Paste the base64 identity card here...",
    notes_placeholder: "Notes (optional)",
    add_trusted_peer: "Add Trusted Peer",
    no_trusted_peers: "No trusted peers yet. Share your identity card with others to get started.",

    // -- ImportSuccessCelebration --
    import_complete: "Import Complete",
    // {count} resources
    resources_imported: "{count} resource{plural} imported",
    // {count} skipped
    skipped_conflicts: "{count} skipped (conflicts)",

    // -- InlineConfirm --
    confirm: "Confirm",

    // -- NetworkAccessScopeBadge --
    scope_none_label: "No Network Access",
    scope_none_desc: "This persona does not require external network access.",
    scope_restricted_label: "Known Domains Only",
    scope_restricted_desc: "This persona accesses specific external services.",
    scope_unrestricted_label: "Unrestricted Access",
    scope_unrestricted_desc: "This persona may access any external endpoint.",
    domains: "Domains",
    integrations: "Integrations",
    api_endpoints: "API Endpoints",

    // -- NetworkDashboard --
    network_status: "Network Status",
    checking_network: "Checking network status...",
    status_online: "Online",
    status_offline: "Offline",
    stat_status: "Status",
    stat_port: "Port",
    stat_discovered: "Discovered",
    stat_connected: "Connected",

    // -- PeerCard --
    disconnect: "Disconnect",
    connect: "Connect",
    view_details: "View details",

    // -- PeerDetailDrawer --
    peer_info: "Peer Info",
    trust_label: "Trust",
    trusted: "Trusted",
    unknown: "Unknown",
    first_seen: "First seen",
    last_seen: "Last seen",
    address: "Address",
    shared_resources: "Shared Resources",
    sync_manifest: "Sync manifest",
    no_shared_resources: "No shared resources. Sync the manifest to check.",

    // -- PeerList --
    discovered_peers: "Discovered Peers",
    refresh: "Refresh",
    scanning_network: "Scanning local network...",
    lan_hint: "Other Personas instances on the same LAN will appear here automatically.",

    // -- Network metrics --
    message_throughput: "Message Throughput",
    sent: "Sent",
    received: "Received",
    dropped_buffer_full: "Dropped (buffer full)",
    rate_limited: "Rate limited",
    connection_lifecycle: "Connection Lifecycle",
    attempts: "Attempts",
    established: "Established",
    avg_connect_time: "Avg connect time",
    disconnects: "Disconnects",
    rejected_capacity: "Rejected (capacity)",
    manifest_sync: "Manifest Sync",
    sync_rounds: "Sync rounds",
    success_fail: "Success / Fail",
    avg_sync_duration: "Avg sync duration",
    entries_received: "Entries received",
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

    // Dashboard home page
    dashboard: {
      title: "Dashboard",
      subtitle: "Operational overview and system status",
      greeting_morning: "Good Morning",
      greeting_afternoon: "Good Afternoon",
      greeting_evening: "Good Evening",
      // Default user display name when none is set
      default_user: "Operator",
      // {count} = number of pending reviews
      pending_reviews_prompt: "pending reviews",
      requiring_attention: "requiring attention.",
      empty_cta: "Create your first agent to get started.",
      // Pipeline error banner -- {source} = data pipeline name
      pipeline_failed: "{source} failed to load",
      // Empty dashboard (no agents, no executions)
      empty_title: "Welcome to Personas",
      empty_subtitle: "Create your first agent to start seeing execution metrics, traffic charts, and activity here.",
      // Action buttons
      create_persona: "Create Persona",
      from_templates: "From Templates",
    },

    // Execution metrics dashboard
    execution_metrics: {
      title: "Execution Metrics",
      total_executions: "Total Executions",
      total_cost: "Total Cost",
      success_rate: "Success Rate",
      avg_latency: "Avg Latency",
      cost_anomalies: "Cost Anomalies Detected",
      no_data: "No execution data for the selected period",
      // Chart headings
      cost_per_day: "Cost per Day",
      executions_by_status: "Executions by Status",
      success_rate_trend: "Success Rate Trend",
      latency_distribution: "Latency Distribution (p50 / p95 / p99)",
      top_personas_by_cost: "Top Personas by Cost",
      // Anomaly badge
      // {date} = anomaly date
      cost_spike: "Cost spike",
      // {sigma} = standard deviations
      above_avg: "above avg",
      top_executions: "Top executions:",
      // Per-persona stats
      // {count} = execution count
      executions_label: "{count} executions",
    },

    // Global execution list
    execution_list: {
      // {count} = total execution count
      recorded: "{count} executions recorded",
      recorded_one: "{count} execution recorded",
      list: "List",
      metrics: "Metrics",
      show_list: "Show execution list",
      show_metrics: "Show metrics dashboard",
      // {count} = visible count, {total} = total count
      showing: "Showing {count} of {total}",
      load_more: "Load More",
      // Filter labels
      filter_all: "All",
      filter_running: "Running",
      filter_completed: "Completed",
      filter_failed: "Failed",
      // Column headers
      col_persona: "Persona",
      col_status: "Status",
      col_duration: "Duration",
      col_started: "Started",
      col_id: "ID",
      // Status filter dropdown
      all_statuses: "All statuses",
      all_personas: "All personas",
      // Empty states
      no_agents: "No agents created yet",
      no_agents_hint: "Create your first agent to see execution activity here.",
      // Row labels
      unknown_persona: "Unknown",
      // Healing retry badge -- {count} = retry number
      healing_retry: "Healing retry #{count}",
    },

    // Manual review
    review: {
      title: "Manual Reviews",
      // {count} = total reviews, {pending} = pending count
      subtitle: "{count} reviews",
      pending_count: "{count} pending",
      cloud_count: "{count} cloud",
      mock_review: "Mock Review",
      seed_tooltip: "Seed a mock review (dev only)",
      // Empty state
      empty_title: "No review items yet",
      empty_subtitle: "Items requiring approval will appear here when agents request human review.",
      // Status filter labels
      filter_all: "All",
      filter_pending: "Pending",
      filter_approved: "Approved",
      filter_rejected: "Rejected",
      // Source filter labels
      source_all: "All",
      source_local: "Local",
      source_cloud: "Cloud",
      // Actions
      approve: "Approve",
      reject: "Reject",
      approve_all: "Approve All",
      reject_all: "Reject All",
      accept: "Accept",
      accept_all: "Accept all",
      reject_all_items: "Reject all",
      processing: "Processing...",
      deselect: "Deselect",
      select_all: "Select all",
      // Bulk action bar
      // {count} = number of selected reviews
      confirm_bulk: "{count} reviews?",
      confirm_bulk_one: "{count} review?",
      pending_selected: "pending reviews selected",
      pending_selected_one: "pending review selected",
      // Conversation thread
      unknown_persona: "Unknown Persona",
      severity_label: "severity",
      cloud_badge: "Cloud",
      execution_link: "Execution",
      context_label: "Context",
      you: "You",
      agent: "Agent",
      review_status: "Review {status}",
      // Decision items
      decisions_label: "Decisions",
      // {count} = number of decision items
      decisions_count: "({count} items)",
      accepted_label: "accepted",
      rejected_label: "rejected",
      undecided_label: "undecided",
      // Action bar
      reply_placeholder: "Reply to this review...",
      cloud_reply_placeholder: "Response message (optional)...",
      cloud_action_hint: "Approve or reject this cloud review",
      reply_hint: "Enter to send -- Shift+Enter for new line",
      send_message: "Send message",
      // Approve with decision counts -- {accepted}/{total}
      approve_with_count: "Approve ({accepted}/{total})",
      // Triage player
      all_caught_up: "All caught up! No pending reviews.",
      // {current}/{total}
      queue_label: "Queue",
      select_action: "Select an action",
      required: "(required)",
      add_notes: "Add notes",
      notes_placeholder: "Add review notes...",
      select_action_first: "Select a suggested action first",
      // Focus flow (view mode)
      split: "Split",
      table: "Table",
      split_tooltip: "Split view with chat",
      table_tooltip: "Table only",
      review_detail: "Review Detail",
      select_review: "Select a review to view",
      // Technical context
      technical_context: "Technical Context",
    },

    // Messages
    messages_view: {
      title: "Messages",
      // {count} = total thread count
      threads_subtitle: "{count} threads",
      threads_subtitle_one: "{count} thread",
      // {count} = total message count
      messages_subtitle: "{count} messages recorded",
      messages_subtitle_one: "{count} message recorded",
      mock_message: "Mock Message",
      seed_tooltip: "Seed a mock message (dev only)",
      flat_view: "Flat view",
      threaded_view: "Threaded view",
      mark_all_read: "Mark All Read",
      // {count}/{total} threads
      threads_of: "{count} of {total} threads",
      // Empty states
      no_threads: "No message threads yet",
      no_threads_hint: "Threads are created automatically when agents produce messages during executions.",
      no_messages: "No messages yet",
      no_messages_hint: "Messages are created when agents run and communicate with each other.",
      no_filter_match: "No messages match current filters",
      loading_replies: "Loading replies...",
      // {count} = remaining count
      load_more: "Load More ({count} remaining)",
      // Column headers
      col_title: "Title",
      col_priority: "Priority",
      col_delivery: "Delivery",
      col_status: "Status",
      col_created: "Created",
      // Priorities
      all_priorities: "All priorities",
      // Read filter
      all_statuses: "All statuses",
      read: "Read",
      unread: "Unread",
      new_badge: "New",
      // Delivery statuses
      failed_count: "{count} failed",
      pending_count: "{count} pending",
      sent_count: "{count} sent",
      // Message detail modal
      message_label: "Message",
      // "From {name} -- {time}"
      from_label: "From {name}",
      content_label: "Content",
      view_execution: "View Execution",
      type_label: "Type:",
      delivery_status: "Delivery Status",
      no_channels: "No delivery channels configured",
      confirm_delete: "Confirm delete",
      // Feedback / improve
      improve_agent: "Improve Agent",
      improvement_started: "Improvement started -- you'll be notified when done",
      what_could_be_better: "What could be better?",
      improve_placeholder: "Describe how this output could be improved...",
      submit_improvement: "Submit Improvement",
      starting: "Starting...",
      unknown_persona: "Unknown",
    },

    // Events
    events: {
      title: "Events",
      // {filtered}/{total} events
      subtitle: "{filtered} of {total} events",
      subtitle_one: "{filtered} of {total} event",
      mock_event: "Mock Event",
      seed_tooltip: "Seed a mock event (dev only)",
      // Search
      search_placeholder: "Search events by type, source, or payload...",
      loading_older: "Loading older events...",
      load_older: "Load older events",
      // Empty states
      no_events: "No events yet",
      no_events_hint: "Events from webhooks, executions, and persona actions will appear here as your agents run.",
      no_filter_match: "No events match current filters",
      // Saved views
      save_view: "Save view",
      view_name_placeholder: "View name (e.g. 'Failed webhooks this week')",
      views_label: "Views:",
      delete_view: "Delete view",
      clear_filters: "Clear all filters",
      // Column headers
      col_trigger: "Trigger",
      col_persona: "Persona",
      col_event_name: "Event Name",
      col_status: "Status",
      col_created: "Created",
      // Filter dropdowns
      all_statuses: "All statuses",
      all_types: "All types",
      all_triggers: "All triggers",
      // Source type labels
      source_event: "Event",
      source_manual: "Manual",
      source_system: "System",
      source_scheduled: "Scheduled",
      // Event detail modal
      event_detail_title: "Event:",
      event_detail_status: "Status:",
      event_id: "Event ID",
      project: "Project",
      source: "Source",
      processed: "Processed",
      event_data: "Event Data",
      error: "Error",
    },

    // Health dashboard
    health: {
      title: "Agent Health",
      subtitle: "Real-time health monitoring across all agents",
      all_healthy: "All agents healthy",
      all_healthy_hint: "Every monitored agent is operating normally",
      no_agents: "No agents yet",
      no_agents_hint: "Create agents to start monitoring their health",
      // Health card metrics
      success_rate: "Success Rate",
      avg_latency: "Avg Latency",
      executions: "Executions",
      last_execution: "Last execution",
      never_executed: "Never",
      cost: "Cost",
      // Health status
      healthy: "Healthy",
      warning: "Warning",
      critical: "Critical",
      unknown: "Unknown",
      // Burn rate
      burn_rate: "Burn Rate Projection",
      monthly_budget: "Monthly Budget",
      current_burn: "Current Burn",
      projected: "Projected",
      days_remaining: "Days Remaining",
      // Cascade
      cascade_title: "Cascade Analysis",
      // Predictive alerts
      predictive_alerts: "Predictive Alerts",
      no_alerts: "No predictive alerts at this time",
      // Status page
      status_page: "Status Page",
      operational: "Operational",
      degraded: "Degraded",
      outage: "Outage",
    },

    // Leaderboard
    leaderboard: {
      title: "Agent Leaderboard",
      subtitle: "Performance rankings across all agents",
      no_data: "No leaderboard data available",
      no_data_hint: "Run your agents to start building performance rankings",
      // Metrics
      reliability: "Reliability",
      speed: "Speed",
      efficiency: "Efficiency",
      cost_effectiveness: "Cost Effectiveness",
      overall: "Overall",
    },

    // Activity / analytics shared
    analytics: {
      title: "Analytics",
      subtitle: "Execution patterns and trends",
      loading: "Loading analytics...",
      no_data: "No analytics data available",
      // Chart headings
      executions_over_time: "Executions Over Time",
      success_failure: "Success vs Failure",
      cost_breakdown: "Cost Breakdown",
      // Summary cards
      total_executions: "Total Executions",
      total_cost: "Total Cost",
      avg_success_rate: "Avg Success Rate",
      active_agents: "Active Agents",
      // Filters
      saved_views: "Saved Views",
      create_view: "Create View",
      // Health issues panel
      health_issues: "Health Issues",
      rotation_overview: "Rotation Overview",
    },

    // Usage / cost dashboard
    usage: {
      title: "Usage",
      subtitle: "Cost and resource consumption",
      chart_error: "Chart failed to load",
      chart_error_hint: "An error occurred rendering this chart",
      try_again: "Try Again",
    },

    // SLA dashboard -- see existing sla section above

    // Cron agents
    cron_agents: {
      title: "Scheduled Agents",
      subtitle: "Agents running on automatic schedules",
      no_agents: "No scheduled agents",
      no_agents_hint: "Add a cron trigger to any agent to see it here",
    },

    // Timeline
    timeline: {
      title: "Activity Timeline",
      subtitle: "Unified view of all agent activity",
      no_activity: "No recent activity",
    },

    // Realtime visualizer
    realtime_viz: {
      title: "Event Bus",
      filter_events: "Filter events",
      pause: "Pause",
      resume: "Resume",
      clear: "Clear",
      // Stats bar
      total_events: "Total Events",
      events_per_sec: "Events/sec",
      active_lanes: "Active Lanes",
      // Event detail
      event_type: "Event Type",
      source: "Source",
      target: "Target",
      timestamp: "Timestamp",
      payload: "Payload",
      // Saved views
      saved_views: "Saved Views",
      save_current: "Save Current",
    },

    // Observability extras (beyond existing keys)
    observability_extra: {
      // Auto-refresh toggle
      auto_refresh_on: "Auto-refresh on",
      auto_refresh_off: "Auto-refresh off",
      // Summary card labels
      total_cost: "Total Cost",
      executions_label: "Executions",
      success_rate: "Success Rate",
      active_personas: "Active Personas",
      // System trace
      system_trace: "System Trace Timeline",
      // IPC performance
      ipc_performance: "IPC Performance",
      // Alert panels
      alert_rules_label: "Alert rules",
      alert_history_label: "Alert history",
      // Healing issues
      healing_issues: "Health Issues",
      run_analysis: "Run analysis",
      resolve: "Resolve",
      healing_view_list: "List",
      healing_view_timeline: "Timeline",
      // Healing issue modal labels
      issue_details: "Issue Details",
      // Anomaly drilldown
      anomaly_drilldown: "Anomaly Drill-Down",
      // Spend overview
      spend_overview: "Spend Overview",
      // Metrics charts
      cost_vs_executions: "Cost vs Executions",
      daily_executions: "Daily Executions",
      // IPC panel
      ipc_channel: "IPC Channel",
      avg_duration: "Avg Duration",
      call_count: "Call Count",
      error_rate: "Error Rate",
    },

    // Dashboard widgets
    widgets: {
      recent_activity: "Recent Activity",
      view_all: "View all",
      // {count} = execution count
      total_traffic: "Total Traffic",
      total_errors: "Total Errors",
      traffic_errors_chart: "Traffic & Errors",
      top_performers: "Top Performers",
      // Metric help popover
      metric_help: "Metric Help",
      how_calculated: "How is this calculated?",
      // Detail modal
      details: "Details",
      // Header badges
      messages_badge: "Messages",
      reviews_badge: "Reviews",
      executions_badge: "Executions",
      success_badge: "Success",
      alerts_badge: "Alerts",
      agents_badge: "Agents",
    },

    // Dashboard cards
    cards: {
      // Fleet optimization
      fleet_optimization: "Fleet Optimization",
      fleet_subtitle: "Automated recommendations to improve agent performance",
      // Remote control
      remote_control: "Remote Control",
      remote_subtitle: "Quick actions for agent management",
      // Resume setup
      resume_setup: "Continue Setup",
      resume_subtitle: "Pick up where you left off",
      // Knowledge hub (when used as subtab)
      knowledge_hub: "Knowledge Hub",
    },

    // Activity / Execution metrics dashboard
    activity: {
      title: "Activity",
      // {count} = total recorded executions
      recorded: "{count} executions recorded",
      recorded_one: "{count} execution recorded",
      list: "List",
      metrics: "Metrics",
      show_list: "Show execution list",
      show_metrics: "Show metrics dashboard",
      // Execution metrics dashboard headings
      execution_metrics: "Execution Metrics",
      total_executions: "Total Executions",
      total_cost: "Total Cost",
      success_rate: "Success Rate",
      avg_latency: "Avg Latency",
      cost_anomalies: "Cost Anomalies Detected",
      no_data: "No execution data for the selected period",
      // Chart headings
      cost_per_day: "Cost per Day",
      executions_by_status: "Executions by Status",
      success_rate_trend: "Success Rate Trend",
      latency_distribution: "Latency Distribution (p50 / p95 / p99)",
      top_personas_by_cost: "Top Personas by Cost",
      // {count} = execution count
      executions_label: "{count} executions",
      // Chart legend labels
      completed: "Completed",
      failed: "Failed",
      prev_completed: "Prev Completed",
      prev_failed: "Prev Failed",
      success_pct: "Success %",
      prev_success_pct: "Prev Success %",
      successful: "Successful",
      // Status filter
      all: "All",
      running: "Running",
      all_statuses: "All statuses",
      // {count}/{total}
      showing: "Showing {count} of {total}",
      load_more: "Load More",
      // Column headers
      col_status: "Status",
      col_duration: "Duration",
      col_started: "Started",
      col_id: "ID",
      // Empty states
      no_agents: "No agents created yet",
      no_agents_hint: "Create your first persona to see execution activity here.",
      no_executions: "No executions yet",
      no_executions_hint: "Run an agent to see execution activity here.",
      create_persona: "Create Persona",
      from_templates: "From Templates",
      // Execution detail modal
      execution_label: "Execution",
      unknown: "Unknown",
    },

    // Analytics dashboard
    analytics_dashboard: {
      title: "Analytics",
      subtitle: "Unified cost, execution, and tool usage analytics",
      metrics_unavailable: "Metrics unavailable",
      auto_refresh_on: "Auto-refresh ON (30s)",
      auto_refresh_off: "Auto-refresh OFF",
      // {count} = number of anomalies
      cost_anomalies_detected: "{count} cost anomalies detected",
      cost_anomaly_detected: "{count} cost anomaly detected",
      // Chart titles
      cost_over_time: "Cost Over Time",
      execution_health: "Execution Health",
      tool_usage_over_time: "Tool Usage Over Time",
      executions_by_persona: "Executions by Persona",
      latency_chart: "Latency (p50 / p95 / p99)",
      tool_invocations: "Tool Invocations",
      no_execution_data: "No execution data",
      // Chart legend
      prev_cost: "Prev Cost",
      successful: "Successful",
      failed: "Failed",
      prev_successful: "Prev Successful",
      prev_failed: "Prev Failed",
      invocations: "Invocations",
      // Anomaly strip
      anomaly_click_hint: "Click a diamond marker on the chart to investigate",
      // Saved views
      saved_views: "Saved Views",
      save_current_view: "Save Current View",
      smart_presets: "Smart Presets",
      your_saved_views: "Your Saved Views",
      view_name_placeholder: "View name...",
      save_view: "Save view",
      delete_view: "Delete view",
      this_week_vs_last: "This Week vs Last Week",
      this_month_vs_last: "This Month vs Last Month",
      // Health issues panel
      health_issues: "Health Issues",
      run_analysis: "Run Analysis",
      analyzing: "Analyzing...",
      analysis_complete: "Analysis complete",
      issues_found: "{count} issues found",
      issues_found_one: "{count} issue found",
      auto_fixed: "auto-fixed",
      executions_scanned: "{count} executions scanned",
      executions_scanned_one: "{count} execution scanned",
      no_open_issues: "No open issues",
      run_analysis_hint: "Run analysis to check for problems.",
      // Issue filter chips
      filter_all: "All",
      filter_open: "Open",
      filter_auto_fixed: "Auto-fixed",
      resolve: "Resolve",
      breaker: "breaker",
      fixed: "fixed",
      retry: "retry",
      // Rotation overview
      credential_rotation: "Credential Rotation",
      no_rotation_policies: "No rotation policies",
      no_rotation_hint: "Configure rotation on credentials in the Vault.",
      // {count} = number of active items
      active_count: "{count} active",
      // {count} = number expiring soon
      soon_count: "{count} soon",
      // {count} = number of issues
      issues_count: "{count} issues",
      issues_count_one: "{count} issue",
      never: "never",
      fail_count: "{count}x fail",
    },

    // Cron agents page
    cron: {
      title: "Cron Agents",
      subtitle: "Background agents running on scheduled intervals",
      mock_schedule: "Mock Schedule",
      seed_tooltip: "Seed a mock schedule (dev only)",
      // {count} = scheduled count
      scheduled_count: "{count} scheduled",
      // {count} = headless count
      headless_count: "{count} headless",
      loading: "Loading cron agents...",
      no_agents: "No scheduled agents found.",
      no_agents_hint: "Create a schedule trigger on any agent to see it here.",
      headless_section: "Headless Background Agents",
      interactive_section: "Interactive Scheduled Agents",
      scheduled_section: "Scheduled Agents",
      headless_badge: "headless",
      no_schedule: "no schedule",
      // {interval} = formatted interval
      every_interval: "every {interval}",
      next: "next",
      last: "last",
    },

    // Timeline
    activity_timeline: {
      title: "Activity Timeline",
      // {events} = event count, {messages} = message count
      subtitle: "{events} events, {messages} messages",
      all: "All",
      events: "Events",
      messages: "Messages",
      no_activity: "No activity yet",
      high: "High",
    },

    // SLA card metrics
    sla_card: {
      successful: "Successful",
      failed: "Failed",
      avg_latency: "Avg Latency",
      p95_latency: "P95 Latency",
      cost: "Cost",
      mtbf: "MTBF",
      auto_healed: "Auto-Healed",
      cancelled: "Cancelled",
      // {count} = number of failing
      failing: "{count} failing",
      // {count} = number healed
      healed: "{count} healed",
    },

    // Realtime visualizer
    realtime_page: {
      title: "Event Bus Monitor",
      live_subtitle: "Live visualization of event flows and persona interactions",
      // {range} = time range, {speed} = playback speed
      replay_subtitle_1d: "Replaying last 24 hours at {speed}x speed",
      replay_subtitle_7d: "Replaying last 7 days at {speed}x speed",
      // Connection status
      paused: "Paused",
      live: "Live",
      offline: "Offline",
      connection_paused: "Connection status: Paused",
      connection_live: "Connection status: Live",
      connection_offline: "Connection status: Disconnected",
      // Stats bar labels
      events_per_min: "events/min",
      pending: "pending",
      success: "success",
      in_window: "in window",
      // Actions
      test_flow: "Test Flow",
      testing_flow: "Testing flow...",
      test_event_flow: "Test event flow",
      resume: "Resume",
      pause: "Pause",
      resume_stream: "Resume realtime stream",
      pause_stream: "Pause realtime stream",
      // Filter bar
      search_events: "Search events...",
      filter_type: "Type",
      filter_status: "Status",
      filter_source: "Source",
      filter_agent: "Agent",
      clear: "Clear",
      // Saved views
      views: "Views",
      no_saved_views: "No saved views yet",
      save_current_filter: "Save current filter",
      view_name_placeholder: "View name...",
      delete_saved_view: "Delete saved view",
      // Event log sidebar
      event_log: "Event Log",
      // {count} = number of entries
      entries: "{count} entries",
      filter_events: "Filter events...",
      no_events: "No events yet",
      open_in_drawer: "Open in detail drawer",
      // Event detail labels
      event_label: "Event",
      status_label: "Status",
      source_label: "Source",
      target_label: "Target",
      id_label: "ID",
      error_label: "Error",
      payload_label: "Payload",
      close_event_details: "Close event details",
      // Timeline player
      reset_to_start: "Reset to start",
      cycle_speed: "Cycle playback speed",
      exit_replay: "Exit replay",
      // Variant labels
      galaxy: "Galaxy",
      galaxy_desc: "Orbital constellation with comet trails",
      lanes: "Lanes",
      lanes_desc: "Horizontal swim-lane flow diagram",
    },

    // Memories child components
    memory_form: {
      agent: "Agent",
      category: "Category",
      title: "Title",
      title_placeholder: "e.g. Always use metric units",
      content: "Content",
      content_placeholder: "Describe what the agent should remember...",
      importance: "Importance",
      tags: "Tags",
      tags_hint: "(comma-separated)",
      tags_placeholder: "e.g. units, formatting, output",
      save_memory: "Save Memory",
      saving: "Saving...",
      created_success: "Memory created successfully",
      fill_required: "Fill in all required fields to save",
      saving_memory: "Saving memory...",
    },

    // Memory filter bar
    memory_filter: {
      search_placeholder: "Search memories...",
      all_agents: "All agents",
      all_categories: "All categories",
    },

    // Memory action card
    memory_actions: {
      dismiss_suggestion: "Dismiss suggestion",
      memory_insights: "Memory Insights",
      // {count} = suggestion count
      suggestions: "{count} suggestions",
      suggestions_one: "{count} suggestion",
    },

    // Conflict card
    memory_conflict: {
      memory_a: "Memory A",
      memory_b: "Memory B",
      merge: "Merge",
      keep: "Keep",
      vs: "vs",
    },

    // Observability charts
    observability_charts: {
      cost_over_time: "Cost Over Time",
      executions_by_persona: "Executions by Persona",
      execution_health: "Execution Health",
      successful: "Successful",
      failed: "Failed",
      anomalies_detected: "{count} cost anomalies detected",
      anomaly_detected: "{count} cost anomaly detected",
      anomaly_click_hint: "Click a diamond marker on the chart to investigate",
      clear_traces: "Clear completed traces",
      all_operations: "All operations",
    },

    // Health sub-module extra keys
    health_extra: {
      success: "Success",
      burn: "Burn",
      healing: "Healing",
      rollbacks: "Rollbacks",
      improving: "Improving",
      degrading: "Degrading",
      stable: "Stable",
      // {pct}% = success percentage
      success_pct: "{pct}% success",
      // Budget exhaustion
      budget_exhaustion: "Budget exhaustion in",
      exhausted: "exhausted",
      // Predicted failure
      predicted_failure: "Predicted failure spike in",
      // Status page
      loading_status: "Loading status page data...",
      no_personas: "No personas to display.",
      score_label: "Score",
      uptime_30d: "30d uptime",
      updated: "Updated {time}",
      legend: "Legend:",
      operational: "Operational",
      degraded: "Degraded",
      outage: "Outage",
      no_data: "No data",
      // Score breakdown
      success_rate_label: "Success Rate",
      latency_p95: "Latency (p95)",
      cost_anomalies: "Cost Anomalies",
      // {count} = detected anomalies
      detected: "{count} detected",
      healing_issues: "Healing Issues",
      // {count} = open issues
      open: "{count} open",
      sla_compliance: "SLA Compliance",
      // {count} = consecutive failures
      consecutive_failures: "{count} consecutive failures",
      consecutive_failure: "{count} consecutive failure",
    },

    // System health panel
    system_health: {
      title: "System Checks",
      subtitle: "Verifying your environment is ready",
      re_run_checks: "Re-run checks",
      ollama_title: "Ollama Cloud API Key",
      ollama_subtitle: "Optional -- unlocks free cloud models (Qwen3 Coder, GLM-5, Kimi K2.5) for all agents.",
      litellm_title: "LiteLLM Proxy Configuration",
      litellm_subtitle: "Optional -- route agents through your LiteLLM proxy for model management and cost tracking.",
      save_key: "Save Key",
      save_configuration: "Save Configuration",
      litellm_footer: "These settings are stored locally and shared across all agents configured to use the LiteLLM provider.",
      ipc_error: "The application bridge is not responding. Try restarting the app. You can still continue to explore the interface.",
      issues_warning: "Some checks reported issues. You can still continue, but some features may not work correctly.",
    },

    // Manual review extra keys
    review_extra: {
      add_note: "Add a note (optional)...",
      confirm: "Confirm",
      processing: "Processing...",
      clear_verdicts: "Clear all verdicts",
      retry_with_changes: "Retry with changes",
      reject_all: "Reject all",
      quick_actions: "Quick Actions",
      // {count} = accepted count
      accepted: "{count} accepted",
      // {count} = rejected count
      rejected: "{count} rejected",
      // {count} = undecided count
      undecided: "{count} undecided",
    },

    // Dashboard widget extra keys
    widgets_extra: {
      execution_health_chart: "Execution Health",
      cost_over_time_chart: "Cost Over Time",
      successful: "Successful",
      failed: "Failed",
      close: "Close",
      dismiss_help: "Dismiss help",
      skip_tour: "Skip tour entirely",
    },
    remote_control_card: { connect_to_desktop: "Connect to Desktop", connect_description: "Run agents using your desktop CLI via Remote Control. Start {command} on your computer, then connect here.", requires_subscription: "Requires Claude Pro or Max subscription" },
    resume_setup_card: { resume_tour: "Resume Tour", left_off_at: "You left off at", steps_completed: "{completed}/{total} steps completed", skip_tour: "Skip tour entirely", continue_label: "Continue" },
    detail_modal: { close: "Close" },
    metric_help_popover: { help_for: "Help for {label}", dismiss_help: "Dismiss help", healthy: "Healthy:", click: "Click:", got_it: "Got it, don't show again" },
    install_button: { install_node: "Install Node.js", install_cli: "Install Claude CLI", downloading: "Downloading...", installing: "Installing...", installed_success: "Installed successfully", installation_failed: "Installation failed", try_manually: "Try running manually:", retry: "Retry", official_page: "Official page" },
    section_card: { checking: "Checking {section}...", edit_key: "Edit Key", configure: "Configure", edit_config: "Edit Config", signing_in: "Signing in...", sign_in_google: "Sign in with Google", working: "Working...", connect_claude: "Connect to Claude Desktop", disconnect: "Disconnect" },
    metrics_cards: { cost_spike: "Cost spike", above_avg: "above avg", top_executions: "Top executions:" },
    event_log_item: { event_id: "Event ID", project: "Project", source: "Source", processed: "Processed", event_data: "Event Data", copy_event_data: "Copy event data", copied: "Copied", copy: "Copy", error: "Error", system: "System" },
    burn_rate_extra: { title: "Burn Rate Projections", daily_burn: "Daily Burn", projected_monthly: "Projected Monthly", at_risk: "At Risk", top_cost_drivers: "Top Cost Drivers", budget_exhaustion_warnings: "Budget Exhaustion Warnings", exhausted: "Exhausted", days_left: "{days}d left" },
    cascade: { title: "Chain Cascade Map", no_chains: "No chains detected -- all personas operating independently" },
    predictive_alerts_extra: { title: "Predictive Alerts", all_nominal: "All systems nominal", no_alerts: "No predictive alerts -- all personas within healthy parameters.", budget_exhausted: "Budget Exhausted", budget_exhaustion_in: "Budget exhaustion in {days}d", failure_spike_predicted: "Failure rate spike predicted in {days}d", excessive_healing: "Excessive self-healing activity", critical_health: "Critical health status", byom_recommendations: "BYOM Routing Recommendations" },
    annotate_modal: { title: "Add Knowledge Annotation", persona_label: "Attribution Persona", scope_label: "Scope", tool_name: "Tool Name", connector_type: "Connector / Service Type", annotation_label: "Annotation", cancel: "Cancel", saving: "Saving...", save_annotation: "Save Annotation" },
    knowledge_row: { annotation: "Annotation", successes: "Successes", failures: "Failures", avg_cost: "Avg Cost", avg_duration: "Avg Duration", pattern_data: "Pattern Data", collapse_details: "Collapse details", expand_details: "Expand details", verify_annotation: "Verify annotation", dismiss_annotation: "Dismiss annotation" },
    focused_decision: { accept: "Accept", reject: "Reject", media_unavailable: "Media unavailable" },
    review_focus: { all_caught_up: "All caught up", no_pending: "No pending reviews to process.", queue: "Queue", clear: "Clear", clear_all_verdicts: "Clear all verdicts", quick_actions: "Quick Actions", reject_all: "Reject all", accept_all: "Accept all", retry_with_changes: "Retry with changes" },
    memory_card: { confirm: "Confirm", cancel: "Cancel" },
    memory_detail: { title_label: "Title", content_label: "Content", category_label: "Category", importance_label: "Importance", tags_label: "Tags", view_source_execution: "View Source Execution", delete_memory: "Delete Memory", close: "Close" },
    memory_table: { agent: "Agent", title: "Title", category: "Category", priority: "Priority", tags: "Tags", created: "Created" },
    review_results: { title: "AI Memory Review", review_failed: "Review failed" },
    anomaly_drilldown_extra: { title: "Anomaly Drill-Down", value_label: "Value:", baseline_label: "Baseline:", correlating: "Correlating events...", likely_root_causes: "Likely Root Causes", correlated_events: "Correlated Events", no_correlated: "No correlated events found in the \u00b124h window." },
    healing_issue_modal: { issue_resolved: "Issue Resolved", analysis: "Analysis", suggested_fix: "Suggested Fix", copied: "Copied", copy_fix: "Copy Fix", persona_auto_disabled: "Persona auto-disabled", persona_auto_disabled_desc: "This persona was automatically disabled after 5 consecutive failures. Review the error pattern below and re-enable manually once the root cause is resolved.", marking_resolved_note: "Marking resolved means you have addressed this issue outside the healing system.", retry_in_progress: "Retry in progress -- status will update when complete", auto_resolved: "This issue was automatically resolved", close: "Close", resolving: "Resolving\u2026", mark_resolved: "Mark as Resolved" },
    healing_issues_panel: { title: "Health Issues", analyzing: "Analyzing...", run_analysis: "Run Analysis", no_open_issues: "No open issues", run_analysis_hint: "Run analysis to check for problems.", healing_audit_log: "Healing Audit Log", no_silent_failures: "No silent failures recorded." },
    healing_timeline: { loading: "Loading timeline...", no_events: "No healing events", no_events_hint: "Run analysis to build the resilience timeline.", knowledge_base: "Knowledge Base", patterns_hint: "Patterns influencing healing decisions" },
    ipc_panel: { title: "IPC Performance", by_command: "By Command", slowest_calls: "Slowest Calls", command: "Command", calls_header: "Calls", duration_header: "Duration", when_header: "When" },
    system_trace_extra: { no_traces: "No system traces recorded", no_traces_hint: "Traces appear when design, credential, or template operations run", all_operations: "All operations", clear_completed: "Clear completed traces", span: "Span" },
    event_log_sidebar: { title: "Event Log", no_events: "No events yet", open_detail_drawer: "Open in detail drawer" },
    chart_error: { chart_unavailable: "Chart unavailable" },
    realtime_idle: { idle: "Idle" },
    day_range: { apply: "Apply" },
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

    // DesignReviewsPage -- top-level template page header
    page: {
      title: "Agentic Templates",
      // {count} = number of templates; shown in the page subtitle
      subtitle_one: "{count} template available",
      subtitle_other: "{count} templates available",
    },

    // Explore view -- "Ready to Deploy" section
    explore: {
      ready_to_deploy: "Ready to Deploy",
      ready_to_deploy_hint: "Templates with all connectors configured",
      // {count} = adoption count shown per template card
      adoption_count_one: "{count} adoption",
      adoption_count_other: "{count} adoptions",
      popular_in: "Popular in {role}",
      configure_to_unlock: "Configure connectors to unlock ready-to-deploy templates",
      hero_title: "What do you want to automate?",
      hero_subtitle: "Browse by use case or search for templates that match your workflow needs.",
      hero_search_placeholder: "Search templates by keyword or describe your need...",
      // {count} = templates in a lane
      templates_count_one: "{count} template",
      templates_count_other: "{count} templates",
      view_all: "View all",
      most_adopted: "Most Adopted",
      whats_your_role: "What's your role?",
      categories_for_role: "{count} categories with specialized agent templates for {role} workflows.",
      role_templates: "{role} Templates",
      by_role: "By Role",
      by_need: "By Need",
      classic: "Classic",
    },

    // Automation opportunities rail
    opportunities: {
      title: "Automation Opportunities",
      subtitle: "Workflows you can unlock",
      ready_now: "Ready now",
      add_connector: "Add",
      unlock_more: "to unlock {count} more",
      explore_templates: "Explore {label} templates",
    },

    // Recommended carousel
    recommended: {
      title: "Recommended for You",
      subtitle: "Based on your connectors",
      no_recommendations: "No recommendations available yet.",
    },

    // Trending carousel
    trending: {
      title: "Most Adopted This Week",
    },

    // Empty states
    empty: {
      no_templates: "No generated templates yet",
      no_templates_hint: "Use the Synthesize Team button in the header or the Claude Code skill to generate templates.",
      no_search_results: "No matching templates",
      no_search_results_hint: "Try adjusting your search terms or filters to find what you're looking for.",
      clear_search: "Clear search",
      waiting_for_draft: "Waiting for persona draft",
      waiting_for_draft_hint: "The AI is generating a draft based on your selections. This usually takes a few seconds.",
    },

    // Background banners
    banners: {
      draft_prefix: "Draft: ",
      step_click_resume: "Step: {step} -- click to resume",
      discard_draft: "Discard draft",
      adoption_in_progress: "Template adoption in progress",
      click_to_view_progress: "Click to view progress",
      rebuilding: "Rebuilding: {name}",
      status_testing: "Testing",
      status_completed: "Completed",
      status_failed: "Failed",
      click_to_view_result: "Click to view result",
      click_to_view_output: "Click to view output",
    },

    // Search bar and filters
    search: {
      switch_to_keyword: "Switch to keyword search",
      switch_to_ai: "Switch to AI search",
      few_results: "Few results found",
      try_ai_search: "Try AI search",
      ai_searching: "Searching with AI -- results will appear when ready...",
      ai_results_one: "{count} result",
      ai_results_other: "{count} results",
      show_log: "Show Log",
      hide_log: "Hide Log",
      placeholder_default: "Search templates... (try category: difficulty: setup:)",
      placeholder_ai: "Describe what you need, then press Enter...",
      placeholder_add_more: "Add more filters or search...",
      list_view: "List view",
      explore_view: "Explore view",
      comfortable_view: "Comfortable view",
      compact_view: "Compact view",
      recommended_for_you: "Recommended for you",
      connectors_label: "Connectors",
      components_label: "Components",
      search_connectors: "Search connectors...",
      search_components: "Search components...",
      no_matching_connectors: "No matching connectors",
      no_connectors_available: "No connectors available",
      no_matching_components: "No matching components",
      no_components_available: "No components available",
      clear_all: "Clear all",
      admin_tools: "Admin tools",
      deduplicate: "Deduplicate",
      backfill_pipelines: "Backfill Pipelines",
      backfill_tools: "Backfill Tools",
      coverage_all: "All",
      coverage_ready: "Ready",
      coverage_partial: "Partial",
      autocomplete_categories: "Categories",
      autocomplete_difficulty: "Difficulty",
      autocomplete_setup_time: "Setup Time",
      autocomplete_suggestions: "Suggestions",
    },

    // Virtual list column headers
    list: {
      template_name: "Template Name",
      components: "Components",
      adoptions: "Adoptions",
    },

    // Row action menu
    row_actions: {
      row_actions_label: "Row actions",
      view_details: "View Details",
      rebuild: "Rebuild",
      delete_template: "Delete template",
    },

    // Connector readiness
    connector_readiness: {
      click_to_add: "click to add credential",
      ready: "Ready",
      partial: "Partial",
      setup_needed: "Setup needed",
      needs_setup: "Needs setup",
      not_ready: "Not ready",
      needs_credential: "needs credential",
      not_installed: "not installed",
    },

    // Template detail modal
    detail_modal: {
      adopted: "{count} adopted",
      reference_patterns: "Reference patterns",
      adopt_as_persona: "Adopt as Persona",
      try_it: "Try It",
      design_unavailable: "Design data unavailable for this template.",
    },

    // Overview tab (inside detail modal)
    overview_tab: {
      loading_metrics: "Loading performance metrics...",
      metrics_unavailable: "Performance metrics unavailable",
      metrics_load_error: "Could not load metrics for this template.",
      incomplete_data: "Incomplete performance data",
      incomplete_data_hint: "Some metric queries failed. The values below may not reflect actual usage.",
      performance: "Performance",
      adoptions_label: "Adoptions",
      executions_label: "Executions",
      success_label: "Success",
      avg_cost_label: "Avg Cost",
      quality_score: "Quality score",
      use_case_flows: "Use Case Flows",
      nodes: "{count} nodes",
      edges: "{count} edges",
      suggested_adjustment: "Suggested Adjustment",
      adjustment_attempt: "(attempt {attempt}/3)",
      dimension_completion: "Dimension Completion",
      dimensions_score: "({score}/9 dimensions)",
    },

    // Review expanded detail
    review_detail: {
      design_unavailable: "Design data unavailable for this template.",
      use_case_flows: "Use Case Flows",
      view_diagram: "View diagram",
      apply_rerun: "Apply & Re-run",
      adopt_as_new_persona: "Adopt as New Persona",
      view_raw_json: "View Raw JSON",
      hide_raw_json: "Hide Raw JSON",
      used_references: "This template used reference patterns from prior passing reviews",
    },

    // Rebuild modal
    rebuild_modal: {
      title: "Rebuild Template",
      template_instruction: "Template Instruction",
      custom_direction: "Custom Direction (optional)",
      custom_direction_placeholder: "Add specific requirements, focus areas, or constraints for this rebuild...",
      custom_direction_hint: "The rebuild will regenerate all 9 data dimensions using the Protocol System.",
      rebuilding_with_cli: "Rebuilding template with Claude CLI...",
      waiting_for_output: "Waiting for output...",
      close_continues_bg: "You can close this dialog -- the rebuild will continue in the background.",
      rebuild_complete: "Rebuild Complete",
      rebuild_complete_hint: "The template has been regenerated with all data dimensions. The gallery will refresh to show updated scores.",
      rebuild_failed: "Rebuild Failed",
      unknown_error: "An unknown error occurred during rebuild.",
      start_rebuild: "Start Rebuild",
      cancel_rebuild: "Cancel Rebuild",
      run_in_background: "Run in Background",
    },

    // Preview modal
    preview_modal: {
      preview_title: "Preview: {name}",
      sandboxed_hint: "Sandboxed single-turn execution -- no persona created",
      try_this_template: "Try this template",
      try_description: "Run a sandboxed single-turn execution to see how this persona behaves. Uses the template's system prompt with mock inputs -- nothing is saved.",
      run_preview: "Run Preview",
      no_design_data: "No design data available for this template.",
      ready: "Ready",
      running: "Running...",
      completed: "Completed",
      execution_failed: "Execution failed",
      run_again: "Run Again",
      close_test_continues: "You can close -- test will continue in background",
    },

    // Expanded row content
    expanded: {
      adopt: "Adopt",
      try_it: "Try It",
      flows: "Flows",
      use_cases: "Use Cases",
      architecture: "Architecture",
      events: "Events",
      reviews_label: "Reviews",
      notifications: "Notifications",
    },

    // Matrix command center
    matrix_cmd: {
      identity: "Identity",
      instructions: "Instructions",
      tool_guidance: "Tool Guidance",
      examples: "Examples",
      error_handling: "Error Handling",
      initializing: "Initializing...",
      initializing_hint: "Creating draft agent and starting CLI",
      describe: "Describe",
      import_label: "Import",
      describe_placeholder: "Describe what your agent should do... (Enter to generate)",
      additional_instructions: "Additional instructions...",
      web_search: "Web Search",
      web_browse: "Web Browse",
      build_label: "Build",
      adjust_placeholder: "Adjust anything...",
      test_agent: "Test Agent",
      save_version: "Save Version",
    },

    // Questionnaire modal
    questionnaire: {
      header: "{label} -- Question {current} of {total}",
      answered: "{count} answered",
      cancel_setup: "Cancel setup",
      type_your_answer: "Type your answer...",
      default_label: "Default: {value}",
      select_project: "Select a codebase project...",
      navigate_hint: "navigate",
      skip_all: "Skip all",
      submit_answers: "Submit Answers",
      answer_remaining: "Answer remaining ({count})",
      next: "Next",
      setup: "Setup",
    },

    // Sandbox warning banner
    sandbox_banner: {
      community_sandbox: "Community Template -- Sandbox Mode",
      event_emission_disabled: "Event emission disabled",
      chain_triggers_disabled: "Chain triggers disabled",
      webhook_triggers_disabled: "Webhook triggers disabled",
      polling_triggers_disabled: "Polling triggers disabled",
      human_review_required: "Human review required",
      budget_cap_enforced: "Budget cap enforced",
      max_concurrent_one: "Max {max} concurrent run",
      max_concurrent_other: "Max {max} concurrent runs",
    },

    // N8n workflow import wizard
    n8n: {
      // ConnectorRow
      credential_label: "Credential: {name}",
      n8n_type_label: "n8n type: {type}",
      test: "Test",
      link_existing: "Link Existing",
      add_new: "Add New",
      // CredentialPicker
      best_match: "Best match",
      other_credentials: "Other credentials",
      no_stored_credentials: "No stored credentials found",
      // N8nEntitiesTab
      no_entities_selected: "No entities selected.",
      go_back_to_analyze: "Go back to the Analyze step to select tools and triggers.",
      entities_generated: "Entities generated by the transformation.",
      entities_from_workflow: "Items from your n8n workflow associated with this persona.",
      ready_count: "{count} ready",
      missing_count: "{count} missing",
      edit_selection: "Edit Selection",
      test_all: "Test All",
      connectors_count: "Connectors ({count})",
      general_tools_count: "General Tools ({count})",
      triggers_count: "Triggers ({count})",
      // N8nUseCasesTab
      no_use_cases_design: "No structured use cases found in design context.",
      no_use_cases_yet: "No use cases generated yet.",
      use_adjustment_hint: "Use the adjustment input below to request use case generation.",
      use_cases_identified: "{count} use case(s) identified",
      informational_only: "This use case is informational only",
      view_example_output: "View example output",
      test_use_case: "Test this use case",
      save_to_test: "Save to test",
      example_output: "Example output:",
      no_sample_data: "// No sample data provided",
      capabilities_label: "Capabilities",
      request_ai_adjustments: "Request AI Adjustments",
      adjustment_placeholder: "Example: Add more use cases, make error handling stricter...",
      apply: "Apply",
      // N8nEditStep
      use_cases_tab: "Use Cases",
      tools_and_connectors_tab: "Tools & Connectors",
      test_output: "Test Output",
      lines_count: "{count} lines",
      // N8nImportTab
      import_error: "Import Error",
      dismiss: "Dismiss",
      partial_session_restore: "Partial Session Restore",
      // N8nParserResults
      analyzing_workflow: "Analyzing workflow and preparing transformation...",
      usually_one_minute: "Usually takes about 1 minute",
      import_another: "Import Another",
      platform_confirm: "This looks like a {platform} workflow, but we're not 100% sure. Is that correct?",
      yes_thats_right: "Yes, that's right",
      no_reupload: "No, re-upload",
      tools_count: "{count} tools",
      triggers_count_summary: "{count} triggers",
      connectors_count_summary: "{count} connectors",
      selected_for_import: "selected for import",
      // N8nParserResultsSections
      tools_header: "Tools ({count})",
      triggers_header: "Triggers ({count})",
      connectors_header: "Connectors ({count})",
      // N8nSessionList
      previous_imports: "Previous Imports",
      sessions_count: "{count} session(s)",
      retry_label: "Retry",
      delete_session: "Delete session",
      failed_to_load_imports: "Failed to load previous imports. Please retry.",
      failed_to_delete_session: "Failed to delete session. Please retry.",
      failed_to_load_session: "Failed to load session. Please retry.",
      // ConnectorHealthRail
      connectors_ready: "{ready} of {total} connector(s) ready",
      no_credential: "No credential",
      // N8nConfirmStep / PersonaPreviewCard
      persona_preview: "Persona Preview",
      unnamed_persona: "Unnamed Persona",
      no_description: "No description provided",
      tools_label: "Tools",
      triggers_label: "Triggers",
      connectors_label: "Connectors",
      reviews_label: "Reviews",
      memory_label: "Memory",
      events_label: "Events",
      tools_require_credentials: "{count} tool(s) require credentials not yet configured:",
      system_prompt_preview: "System Prompt Preview",
      confirm_hint: "Review the details above, then click \"Confirm & Save Persona\" to create.",
      // SuccessBanner
      persona_created: "Persona Created Successfully",
      persona_ready: "{name} is ready to use. Find it in the sidebar.",
      entities_failed: "{count} entity/entities failed",
      configure_connectors: "Configure connector(s): {names}",
      // N8nUploadStep
      upload_file: "Upload File",
      paste_json: "Paste JSON",
      from_url: "From URL",
      drop_file_here: "Drop your workflow file here",
      import_from_any_platform: "Import a workflow from any platform",
      click_to_browse: "Click to browse or drag and drop your exported workflow",
      continue_btn: "Continue",
      press_enter_or_click: "Press Enter or click to continue",
      paste_workflow_json: "Paste workflow JSON",
      paste_placeholder: "Paste your exported workflow JSON here...",
      import_btn: "Import",
      import_from_url: "Import from URL",
      url_description: "Paste a URL to a raw workflow JSON file. Supports GitHub raw URLs, Gist links, and direct JSON endpoints.",
      fetching: "Fetching",
      fetch: "Fetch",
      accepts_label: "Accepts:",
      // N8nTransformChat
      customize_persona: "A few questions to customize your persona",
      answer_then_generate: "Answer below, then click Generate",
      list_view: "List",
      focus_view: "Focus",
      no_config_needed: "No configuration needed",
      click_generate_defaults: "Click Generate to create your persona draft with defaults.",
      your_answers: "Your answers",
      // N8nWizardFooter
      back: "Back",
      review_and_confirm: "Review & Confirm",
      persona_saved: "Persona Saved",
      saving: "Saving...",
      confirm_and_save: "Confirm & Save Persona",
      connectors_need_credentials: "{count} connector(s) need credentials",
      testing_btn: "Testing...",
      test_passed: "Test Passed",
      retest: "Retest",
      test_persona: "Test Persona",
      fix_and_regenerate: "Fix & Regenerate",
      build_persona: "Build Persona",
      analyzing_btn: "Analyzing...",
      // N8nStepIndicator
      upload_step: "Upload",
      analyze_step: "Analyze",
      // StreamingSections
      streaming_sections: "Streaming Sections",
      awaiting_next_section: "Awaiting next section...",
      // TransformPhaseStepper
      analyze_phase: "Analyze",
      questions_phase: "Questions",
      generate_phase: "Generate",
      // N8nQuestionStepper
      type_your_answer: "Type your answer...",
      navigate_hint: "Use arrow keys to navigate",
    },

    // Activity diagram
    diagram: {
      no_flow_data: "No flow data available",
      nodes_count: "{count} nodes",
      edges_count: "{count} edges",
      connectors_count: "{count} connector(s)",
      decisions_count: "{count} decision(s)",
      error_label: "Error",
      request_label: "Request",
      response_label: "Response",
    },

    // Design preview
    design: {
      connectors_and_tools: "Connectors & Tools",
      general_tools: "General Tools",
      credential_ready: "Credential ready",
      configure_credential: "Configure credential",
      events_and_triggers: "Events & Triggers",
      what_activates: "What activates this persona",
      triggers_section: "Triggers",
      event_subscriptions: "Event Subscriptions",
      messages_and_notifications: "Messages & Notifications",
      how_communicates: "How this persona communicates",
      requires_connector: "Requires {name}",
      feasibility_assessment: "Feasibility Assessment",
      confirmed_capabilities: "Confirmed Capabilities",
      issues_label: "Issues",
      suggested_next_steps: "Suggested Next Steps",
    },

    // Gallery card renderers
    card: {
      use_cases_label: "Use Cases",
      connectors_label: "Connectors",
      triggers_label: "Triggers",
      no_flows: "No flows",
      none_label: "None",
      more_count: "+{count} more",
      system_prompt: "System Prompt",
    },

    // Gallery matrix
    matrix_grid: {
      prerequisites: "Prerequisites",
      all_set_start: "All set -- Start Adoption",
      continue_to_adoption: "Continue to Adoption",
      setup_in_wizard: "(setup in wizard)",
      credential_configured: "Credential configured",
      connector_not_installed: "Connector not installed",
      needs_credential: "Needs credential",
      setup_btn: "Setup",
    },

    // Adoption
    adopt_modal: {
      adopt_template: "Adopt Template",
      loading_template: "Loading template into matrix...",
      configure_your_persona: "Configure Your Persona",
      cancel: "Cancel",
      submit_all: "Submit All",
      submit_remaining: "Submit All ({remaining} remaining)",
      custom_btn: "Custom...",
      type_custom_value: "Type your custom value...",
      // Vault auto-detection badge shown when a connector question is pre-answered from credentials
      auto_detected: "Auto-detected from credentials",
    },

    // Scan results
    scan: {
      scanning_draft: "Scanning persona draft...",
      checking_unsafe: "Checking for malicious instructions and unsafe patterns",
      scan_passed: "Safety scan passed",
      no_concerns: "No security concerns detected in this persona draft",
      info_notes: "{count} informational note(s) for review",
      critical_issues: "Critical security issues detected",
      security_warnings: "Security warnings detected",
      review_findings: "review findings before creating this persona",
      critical_label: "Critical",
      warnings_label: "Warnings",
      informational_label: "Informational",
      source_label: "Source:",
    },

    // Team synthesis
    team_synthesis: {
      title: "Synthesize Team",
      subtitle: "AI selects templates and assembles a connected team",
      team_name_label: "Team Name",
      team_name_placeholder: "e.g., Content Pipeline Team",
      describe_team: "Describe what this team should do",
      describe_placeholder: "e.g., Monitor social media mentions, analyze sentiment, generate reports, and send alerts to Slack when negative trends are detected",
      synthesizing: "Synthesizing...",
      synthesize_team: "Synthesize Team",
      personas_created: "{count} personas created and connected",
      done: "Done",
    },

    // Blueprint/Glass matrix variants
    matrix_variants: {
      processing: "Processing...",
      run_test: "RUN TEST",
      testing_dots: "TESTING...",
      approve_label: "APPROVE",
      view_agent_label: "VIEW AGENT",
      no_data_yet: "No data yet",
      completeness: "Completeness",
      start_test: "Start Test",
      testing_agent: "Testing agent...",
      approve_and_promote: "Approve & Promote",
      view_agent_btn: "View Agent",
    },

    // Activity diagram modal
    diagrams: {
      no_flow_data: "No flow data available",
      nodes_count: "{count} nodes",
      edges_count: "{count} edges",
      connectors_count: "{count} connector(s)",
      decisions_count: "{count} decision(s)",
    },

    // Generation
    generation: {
      create_template: "Create Template",
      create_template_subtitle: "Design a reusable persona template with AI",
      template_name_label: "Template Name",
      run_design_review: "Run Design Review",
      cancel: "Cancel",
      close: "Close",
      generating: "Generating: {name}",
      running: "Running...",
    },

    // Connector edit cell
    connector_edit: {
      credential: "Credential",
      select_credential: "Select credential...",
      connector_type: "Connector Type",
      switch_connector: "Switch connector...",
      no_credentials: "No credentials available for this connector",
      add_in_catalog: "Add in Keys Catalog",
      database: "Database",
      new_table: "New",
      existing_table: "Existing",
      configure_table: "Configure table...",
      existing_table_label: "Existing Table",
      schema: "Schema",
      table_name: "Table name",
      in_app_messages: "In-App Messages",
      not_connected: "not connected",
      no_connectors: "No connectors required",
      linked: "Linked",
      set_up: "Set up",
      more_connectors: "+{count} more",
    },

    // Trigger edit cell
    trigger_edit: {
      schedule: "Schedule",
      schedule_placeholder: "Every weekday at 9am",
      schedule_hint: "Natural language or cron (e.g. \"0 9 * * 1-5\")",
      webhook_url: "Webhook URL",
      check_interval: "Check Interval",
      check_interval_placeholder: "Every 5 minutes",
      no_config_needed: "No configuration needed",
      manual_only: "Manual execution only",
    },

    // Preset edit cells
    preset_edit: {
      select_review: "Select review policy...",
      select_memory: "Select memory strategy...",
      notification_strategy: "Notification strategy...",
      error_handling: "Error handling...",
      add_use_case: "Add use case...",
      halt_on_error: "Halt on error",
      retry_once: "Retry once",
      retry_3x: "Retry 3x",
      notify_continue: "Notify & continue",
      skip_failed: "Skip failed step",
    },

    // Test report modal
    test_report: {
      title: "Test Report",
      passed: "{count} passed",
      failed: "{count} failed",
      skipped: "{count} skipped",
      test_scope: "Test Scope",
      overview: "Overview",
      analysis: "Analysis",
      results: "Results",
      next_steps: "Next Steps",
      connector_credentials: "Connector Credentials",
      matched: "matched",
      not_found: "not found",
      missing_keys_hint: "Add missing API keys in the Keys section before approving this agent.",
      connected_successfully: "Connected Successfully",
      needs_credentials: "Needs Credentials",
      add_keys_hint: "Add the required API keys in the Keys section to enable these tools.",
      connection_failed: "Connection Failed",
      builtin_no_test: "Built-in (No Test Needed)",
      what_happened: "What happened",
      service: "Service",
      response_preview: "Response Preview",
      error_detail: "Error Detail",
      copy: "Copy",
      copied: "Copied",
    },

    // Questionnaire modal
    questionnaire: {
      answered: "{count} answered",
      cancel_setup: "Cancel setup",
      navigate: "navigate",
      skip_all: "Skip all",
      submit_answers: "Submit Answers",
      answer_remaining: "Answer remaining ({count})",
      next: "Next",
      select_project: "Select a codebase project...",
      type_answer: "Type your answer...",
      default_label: "Default: {value}",
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
    type_manual: "Manual",
    type_schedule: "Schedule",
    type_webhook: "Webhook",
    type_polling: "Auto-Check",
    type_event_listener: "Event Listener",
    type_file_watcher: "File Watcher",
    type_clipboard: "Clipboard",
    type_app_focus: "App Focus",
    type_chain: "Chain",
    type_composite: "Combined",

    // Trigger type descriptions (triggerConstants.ts add-trigger form)
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

    // Trigger category labels (triggerConstants.ts category taxonomy)
    category_pull: "Watch",
    category_push: "Listen",
    category_compose: "Combine",
    category_pull_desc: "Poll for changes on an interval",
    category_push_desc: "Receive external signals",
    category_compose_desc: "Chain or compose triggers",

    // Rate limit window labels
    rate_per_minute: "Per minute",
    rate_per_5_minutes: "Per 5 minutes",
    rate_per_hour: "Per hour",

    // Trigger template labels (triggerConstants.ts)
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

    // -- Triggers Page tab headers --
    tab_live_stream: "Live Stream",
    tab_live_stream_subtitle: "Real-time event hub -- agents publish and subscribe to events through this shared bus",
    tab_builder: "Builder",
    tab_builder_subtitle: "Connect personas to event sources -- every event flowing through the bus, with the personas listening to it",
    tab_rate_limits: "Speed Limits",
    tab_rate_limits_subtitle: "Throttling, queue depth, and concurrency limits for triggers",
    tab_test: "Test",
    tab_test_subtitle: "Fire test events into the bus to validate listeners and routing",
    tab_smee_relay: "Local Relay",
    tab_smee_relay_subtitle: "Forward webhooks from public endpoints into your local event bus",
    tab_cloud_webhooks: "Cloud Events",
    tab_cloud_webhooks_subtitle: "Webhook endpoints exposed by deployed cloud workers",
    tab_dead_letter: "Dead Letter Queue",
    tab_dead_letter_subtitle: "Events that failed delivery -- inspect, retry, or discard",
    tab_studio: "Chain Studio",
    tab_studio_subtitle: "Visually compose multi-step trigger chains with conditional routing",
    tab_shared: "Marketplace",
    tab_shared_subtitle: "Discover and subscribe to events shared by other personas",
    full_event_log: "Full Event Log",
    on_label: "On",
    off_label: "Off",
    throttled_label: "Throttled",
    queued_label: "{count} queued",
    unknown_budget_label: "Unknown Budget",
    budget_label: "Budget",
    or_use_templates: "or use templates",
    schedule_mode_label: "Schedule Mode",
    test_fire_label: "Test fire",
    dry_run_label: "Dry run",
    copy_sample_curl: "Copy sample curl",
    event_listener_label: "Event Listener",
    execution_history: "Execution history",
    could_not_load_history: "Could not load history",
    no_executions_recorded: "No executions recorded for this trigger yet",
    replaying_label: "Replaying...",
    replay_label: "Replay",
    local_time: "local time",
    describe_trigger: "Describe your trigger",
    could_not_parse: "Could not parse a trigger from that description. Try something like",
    rate_limiting: "Rate Limiting",
    max_executions: "Max executions",
    cooldown_label: "Cooldown between firings (seconds)",
    max_concurrent_label: "Max concurrent executions",
    unlimited_hint: "0 = unlimited",
    window_usage: "Window usage",
    concurrent_label: "Concurrent",
    cooldown_stat: "Cooldown",
    queued_stat: "Queued",
    clear_all_limits: "Clear all limits",
    dry_run_result_title: "Dry Run Result",
    all_checks_passed: "All checks passed",
    validation_failed: "Validation failed",
    simulated_event: "Simulated Event",
    matched_subscriptions_title: "Matched Subscriptions",
    no_subscriptions_activated: "No subscriptions would be activated",
    active_hours: "Active Hours",
    only_fire_during_active: "Only fire during active hours",
    weekdays_preset: "Weekdays",
    every_day_preset: "Every day",
    hmac_secret_label: "HMAC Secret",
    hmac_help: "Incoming webhooks must include a valid HMAC signature header. A secret will be auto-generated if left empty.",
    auto_generated_hint: "Auto-generated if left empty",
    webhook_url_note: "A unique webhook URL will be shown after creation with a copy button",
    hide_secret: "Hide secret",
    show_secret: "Show secret",
    generate_secret: "Generate random secret",
    watch_subdirs: "Watch subdirectories recursively",
    text_pattern_help: "Only fires when clipboard text matches this pattern",
    app_names_help: "Leave empty to trigger on any app focus change",
    source_filter_optional: "Source filter (optional)",
    op_all_label: "ALL (AND)",
    op_all_desc: "All conditions must match",
    op_any_label: "ANY (OR)",
    op_any_desc: "At least one condition",
    op_sequence_label: "Sequence",
    op_sequence_desc: "Conditions in order",
    time_window_help: "All conditions must be met within this time window",
    credential_event_help: "Link to a credential event instead of a custom endpoint",
    none_use_endpoint: "None - use endpoint URL instead",
    disabled_label: "Disabled",
    manual_label: "Manual",
    pending_label: "Pending",
    fire_label: "Fire",
    webhook_label: "Webhook",
    chain_label: "Chain",
    poll_interval_label: "Poll Interval (seconds)",
    endpoint_url: "Endpoint URL",
    dev_mode_warning: "Dev mode -- this URL is only reachable locally",
    conditions_met: "{met}/{total} conditions met",
    suppressed_label: "suppressed",
    request_inspector: "Request inspector",
    errors_count: "{count} errors",
    could_not_load_log: "Could not load request log",
    no_webhook_requests: "No webhook requests received yet",
    clear_all: "Clear all",
    all_statuses: "All statuses",
    all_types: "All types",
    target_agent_label: "Target Agent",
    broadcast_label: "broadcast",
    live_label: "Live",
    paused_label: "Paused",
    connecting_label: "Connecting",
    events_per_min: "events/min",
    received_label: "received",
    in_buffer: "in buffer",
    resume_label: "Resume",
    pause_label: "Pause",
    no_events_title: "No events on the bus",
    no_events_desc: "Events will appear here in real-time as agents publish and subscribe through the shared event bus.",
    connecting_to_bus: "Connecting to event bus...",
    event_data: "Event Data",
    copy_json: "Copy JSON",
    no_event_data: "No event data",
    publish_test_event: "Publish Test Event",
    publish_test_desc: "Fire a test event into the bus to verify subscriptions and agent routing.",
    event_type_form_label: "Event Type",
    payload_json_label: "Payload (JSON)",
    publishing_label: "Publishing...",
    publish_event: "Publish Event",
    event_published: "Event published",
    dead_letter_help: "Events that failed processing after exhausting all retry attempts. You can retry them manually or discard.",
    no_dead_letters: "No dead-lettered events",
    all_events_processed: "All events processed successfully",
    exhausted_label: "Exhausted",
    no_active_relays: "No active relays",
    smee_relays: "Smee Relays",
    add_relay: "Add Relay",
    create_relay: "Create Relay",
    label_field: "Label",
    channel_url_label: "Channel URL",
    route_to_agent: "Route to Agent",
    broadcast_to_all: "Broadcast to all",
    event_filter_label: "Event Filter",
    no_smee_relays: "No Smee relays configured",
    smee_relay_desc: "Add a Smee relay to receive GitHub webhooks and 3rd-party events in real-time through the event bus.",
    add_first_relay: "Add First Relay",
    how_it_works: "How it works",
    live_stream: "Live Stream",
    cloud_not_connected: "Cloud not connected",
    cloud_not_connected_desc: "Connect to a cloud orchestrator to receive 3rd-party webhooks",
    cloud_relay_active: "Cloud relay active",
    cloud_webhook_triggers: "Cloud Webhook Triggers",
    add_webhook: "Add Webhook",
    deployed_persona: "Deployed Persona",
    select_persona: "Select a persona...",
    create_webhook: "Create Webhook",
    no_webhook_triggers: "No webhook triggers yet",
    no_webhook_triggers_desc: "Create a webhook trigger on a deployed persona to receive 3rd-party POSTs",
    recent_firings: "Recent Firings",
    no_firings: "No firings recorded yet",
    no_rate_limits: "No rate limits configured",
    no_rate_limits_desc: "Add rate limits to your triggers to control execution frequency and prevent API overuse.",
    rate_limits_heading: "Rate Limits",
    triggers_configured: "triggers configured",
    running_stat: "running",
    throttled_stat: "throttled",
    browse_label: "Browse",
    my_subscriptions: "My Subscriptions",
    search_feeds: "Search feeds...",
    loading_catalog: "Loading catalog...",
    no_feeds: "No shared event feeds available yet",
    no_feeds_hint: "Click Refresh to fetch the latest feeds from the cloud",
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

    // -- Account ----------------------------------------------------------
    account: {
      title: "Account",
      subtitle: "Manage your sign-in and profile",
      offline: "Offline",
      sign_out: "Sign out",
      sign_in_prompt: "Sign in to sync your data across devices",
      sign_in_google: "Sign in with Google",
      dismiss: "Dismiss",
      waiting_sign_in: "Waiting for sign-in...",
      complete_sign_in: "Complete sign-in in the popup window",
      cancel: "Cancel",
      // Telemetry section
      telemetry_title: "Troubleshooting Telemetry",
      telemetry_description: "When enabled, anonymous crash reports and feature usage analytics are sent to help identify and fix bugs. No personal data, credentials, or execution content is ever included.",
      telemetry_toggle: "Send anonymous telemetry",
      telemetry_on: "Crash reports and usage analytics are active.",
      telemetry_off: "Telemetry is disabled. No data is sent to Sentry.",
      telemetry_restart: "Restart the app for this change to take effect",
    },

    // -- Appearance -------------------------------------------------------
    appearance: {
      title: "Appearance",
      subtitle: "Customize how the app looks",
      dark: "Dark",
      light: "Light",
      text_size: "Text Size",
      interface_mode: "Interface Mode",
      interface_mode_hint: "Simple mode shows only core features. Power mode unlocks the full interface.",
      theming: "Theming",
      default_tab: "Default",
      custom_tab: "Custom",
      timezone: "Timezone",
      timezone_hint: "Controls how schedule times and cron expressions are displayed throughout the app.",
      brightness: "Brightness",
      brightness_hint: "Adjust screen brightness if the app feels too dark on your display.",
      // Custom theme creator
      custom_theme: "Custom Theme",
      custom_theme_active: "Active",
      custom_theme_hint: "Choose a primary color to auto-derive all others, or override individual colors for full control.",
      base_mode: "Base Mode",
      theme_name: "Theme Name",
      colors: "Colors",
      background_gradient: "Background gradient",
      end_color: "End Color",
      angle: "Angle",
      preview: "Preview",
      save_apply: "Save & Apply",
      applied: "Applied",
      reset: "Reset",
      enter_theme_name: "Enter a theme name",
      // Translation contributor
      language_translations: "Language & Translations",
      translation_keys: "{count} translation keys",
      translation_coverage: "{covered} of {total} keys ({pct}%)",
      coverage_full: "Full",
      coverage_hint: "Translation coverage -- click to export",
      contribute_title: "Contribute translations",
      contribute_hint: "Help translate Personas into your language. Export a language file above, translate the values, and submit via GitHub.",
      contribute_github: "Contribute on GitHub",
    },

    // -- Notifications ----------------------------------------------------
    notifications: {
      title: "Notifications",
      subtitle: "Control which healing alerts trigger notifications",
      // Severity level names
      severity_critical_label: "Critical",
      severity_high_label: "High",
      severity_medium_label: "Medium",
      severity_low_label: "Low",
      // Severity level descriptions
      severity_critical: "Circuit breaker tripped, CLI not found",
      severity_high: "Credential errors, session limits, repeated timeouts",
      severity_medium: "Rate limits, first timeouts (auto-fixable)",
      severity_low: "Informational issues",
      // Weekly digest toggle
      weekly_digest: "Weekly Health Digest",
      digest_title: "Agent Health Digest",
      digest_description: "Weekly notification summarizing health issues across all agents with a total health score",
      // Healing alerts section
      healing_alerts_hint: "Control which auto-fix alerts trigger notifications",
      healing_severity: "Healing Alert Severity",
      // Explanation of how desktop notifications work
      notification_hint: "Desktop notifications use the native OS notification system. In-app toasts appear for critical and high severity issues regardless of these settings.",
    },

    // -- Engine -----------------------------------------------------------
    engine: {
      title: "Engine",
      loading_capabilities: "Loading engine capabilities...",
      detecting_providers: "Detecting installed providers...",
      subtitle: "Configure which CLI providers handle each operation",
      capability_map: "Operation Capability Map",
      operation: "Operation",
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
      defaults_heading: "Defaults from Integration Tests",
      defaults_description: "The default map is derived from Round 9 business-level integration tests that validate each provider against the exact JSON schemas the backend parses. Enabling a provider for an operation it failed may cause unparseable responses. Claude Code is the only provider that passed all operations at 100%.",
    },

    // -- Ambient Context --------------------------------------------------
    ambient: {
      title: "Ambient Context Fusion",
      description: "Ambient context captures clipboard, file changes, and app focus signals to give personas awareness of your desktop workflow.",
      events_broadcast: "{count} events broadcast",
      subscribers: "{count} subscriber",
      subscribers_plural: "{count} subscribers",
      live_context: "Live Context Window",
      total_signals: "{count} total signals",
      no_signals: "No recent signals captured",
      sensory_policy: "Sensory Policy",
      reset_defaults: "Reset to defaults",
      clipboard: "Clipboard",
      file_changes: "File Changes",
      app_focus: "App Focus",
      focus_filter: "Focus App Filter",
      focus_filter_hint: "Only capture signals when these apps are in focus. Empty = capture from any app.",
      focus_filter_placeholder: "e.g. Code.exe",
      add: "Add",
      context_rules: "Context Rules",
      add_rule: "Add Rule",
      context_rules_hint: "Define patterns that trigger proactive persona actions when desktop context matches.",
      rule_name_placeholder: "Rule name (e.g. \"Crash debug helper\")",
      match_sources: "Match sources (empty = all)",
      summary_contains_placeholder: "Summary contains (e.g. \"error\", \"Code.exe\")",
      file_glob_placeholder: "File glob (e.g. *.rs)",
      app_filter_placeholder: "App filter (e.g. Code.exe)",
      action: "Action",
      action_trigger: "Trigger Execution",
      action_emit: "Emit Event",
      action_log: "Log Only",
      cooldown: "Cooldown (sec)",
      cancel: "Cancel",
      create_rule: "Create Rule",
      no_rules: "No context rules defined",
      all_sources: "all sources",
    },

    // -- BYOM (Bring Your Own Model) --------------------------------------
    byom: {
      title: "Bring Your Own Model",
      subtitle: "Configure approved providers, compliance restrictions, and cost-optimized routing",
      loading: "Loading...",
      unsaved_changes: "Unsaved changes",
      reset: "Reset",
      save_policy: "Save Policy",
      fix_errors: "Fix all errors before saving",
      // Policy corruption
      policy_corrupted: "BYOM Policy Corrupted",
      policy_corrupted_desc: "The stored policy JSON could not be parsed. All provider restrictions are currently inactive and executions are blocked. Reset the policy to restore normal operation.",
      reset_policy: "Reset Policy",
      // Enable toggle
      policy_enforcement: "BYOM Policy Enforcement",
      policy_enforcement_desc: "When enabled, provider selection follows your configured rules",
      // Section tabs
      tab_providers: "Providers",
      tab_keys: "API Keys",
      tab_routing: "Cost Routing",
      tab_compliance: "Compliance",
      tab_audit: "Audit Log",
      // Provider list
      allowed_providers: "Allowed Providers",
      allowed_providers_hint: "Select which providers your organization approves. Leave empty to allow all.",
      allowed: "Allowed",
      blocked_providers: "Blocked Providers",
      blocked_providers_hint: "Explicitly block specific providers. Takes precedence over allowed list.",
      blocked: "Blocked",
      provider_usage: "Provider Usage",
      usage_trends: "30-day trends",
      executions: "Executions",
      cost: "Cost",
      avg_duration: "Avg Duration",
      failovers: "{count} failovers",
      no_trend_data: "No trend data",
      test_connection: "Test Connection",
      testing: "Testing...",
      reachable: "Reachable",
      unreachable: "Unreachable",
      // API key management
      api_key_title: "API Key Management",
      api_key_hint: "Configure API keys and endpoints for custom model providers. Keys are stored encrypted in the local database.",
      verify: "Verify",
      remove_key: "Remove key",
      save: "Save",
      stored: "Stored",
      error: "Error",
      // Routing rules
      routing_title: "Cost-Optimized Routing Rules",
      routing_hint: "Route tasks to specific providers/models based on complexity level",
      routing_empty: "No routing rules configured. Add rules to optimize cost by task complexity.",
      add_rule: "Add Rule",
      rule_name_placeholder: "Rule name",
      complexity: "Complexity",
      provider: "Provider",
      model_optional: "Model (optional)",
      // Compliance rules
      compliance_title: "Compliance-Driven Restrictions",
      compliance_hint: "Restrict providers for specific workflow types (e.g., HIPAA, SOC2)",
      compliance_empty: "No compliance rules configured. Add rules to restrict providers for sensitive workflows.",
      compliance_name_placeholder: "Rule name (e.g., HIPAA)",
      workflow_tags: "Workflow Tags (comma-separated)",
      workflow_tags_placeholder: "hipaa, healthcare, pii",
      allowed_providers_label: "Allowed Providers",
      // Audit log
      audit_title: "Provider Audit Log",
      audit_hint: "Compliance trail showing which provider handled each execution",
      audit_empty: "No audit entries yet. Entries are recorded automatically for every execution.",
      audit_provider: "Provider",
      audit_model: "Model",
      audit_persona: "Persona",
      audit_status: "Status",
      audit_cost: "Cost",
      audit_time: "Time",
      failover: "failover",
    },

    // -- Admin ------------------------------------------------------------
    admin: {
      title: "Admin",
      subtitle: "Development tools and testing utilities",
      // Guided tour section
      guided_tour: "Guided Tour",
      tour_hint: "Force-start or reset the onboarding tour for e2e testing",
      tour_active: "Active",
      tour_completed: "Completed",
      tour_dismissed: "Dismissed",
      tour_not_started: "Not started",
      progress: "Progress",
      steps: "steps",
      current_step: "Current Step",
      step_status: "Step Status",
      force_start: "Force Start Tour",
      confirm_reset: "Confirm Reset",
      reset_state: "Reset State",
      force_complete: "Force Complete",
      force_dismiss: "Force Dismiss",
      // User consent section
      user_consent: "User Consent",
      consent_hint: "Reset the first-use consent modal to test onboarding",
      consent_accepted: "Accepted",
      consent_not_accepted: "Not accepted",
      storage_key: "Storage Key",
      reset_consent: "Reset Consent",
      reload_modal: "Reload to Show Modal",
    },

    // -- Data Portability -------------------------------------------------
    portability: {
      title: "Data Portability",
      subtitle: "Export, import, and migrate your workspace data",
      workspace_overview: "Workspace Overview",
      loading_stats: "Loading workspace stats...",
      stats_error: "Failed to load workspace statistics.",
      error_label: "Error",
      // Stat card labels
      personas: "Personas",
      teams: "Teams",
      tools: "Tools",
      groups: "Groups",
      credentials: "Credentials",
      memories: "Memories",
      test_suites: "Test Suites",
      // Export section
      export_import_title: "Workspace Export & Import",
      export_import_hint: "Export your workspace to a portable ZIP archive containing personas, teams, credentials, and related data. Choose exactly what to include. Import restores from a previously exported archive -- imported items are created as new entities (disabled by default).",
      exporting: "Exporting...",
      exported: "Exported!",
      export_workspace: "Export Workspace",
      import_workspace: "Import Workspace",
      import_label: "Import",
      imported: "Imported!",
      cancel: "Cancel",
      passphrase_optional: "Passphrase (optional)",
      import_complete: "Import Complete",
      warnings: "Warnings:",
      // Export selection modal
      export_title: "Export Workspace",
      export_subtitle: "Choose what to include in your export",
      close: "Close",
      loading_data: "Loading workspace data...",
      select_all: "Select All",
      deselect_all: "Deselect All",
      items_selected: "{selected} of {total} items selected",
      of_selected: "{count} of {total} selected",
      encrypt_passphrase: "Encrypt credentials with passphrase",
      optional: "(optional)",
      passphrase_placeholder: "Passphrase (min 8 characters)",
      passphrase_too_short: "Passphrase must be at least 8 characters",
      passphrase_note: "If set, credential secrets will be included in the export and protected with AES-256 encryption.",
      auto_included_note: "Groups, tools, memories, and test suites linked to selected personas are automatically included.",
      no_passphrase_note: " Credential secrets are not included unless a passphrase is set above.",
      export_all: "Export All",
      export_items: "Export {count} Item",
      export_items_plural: "Export {count} Items",
      // Credential portability
      credential_vault: "Credential Vault",
      credential_vault_hint: "Workspace exports do not include credential secrets. Use this section to export and import your vault with password-protected AES-256 encryption.",
      export_credentials: "Export Credentials",
      import_credentials: "Import Credentials",
      passphrase_min: "Passphrase (min 8 chars)",
      passphrase_label: "Passphrase",
      export: "Export",
      credentials_exist: "{count} credential already exist",
      credentials_exist_plural: "{count} credentials already exist",
      conflict_hint: "Choose how to handle each conflict:",
      skip: "Skip",
      keep_both: "Keep Both",
      replace: "Replace",
      import_with_resolutions: "Import with Resolutions",
      cred_import_complete: "Credential Import Complete",
      cred_imported: "{count} imported",
      cred_skipped: ", {count} skipped",
      cred_replaced: ", {count} replaced",
    },

    // -- Config Resolution ------------------------------------------------
    config: {
      title: "Config Resolution",
      subtitle: "Shows which tier (agent / workspace / global) supplies each setting per persona",
      refresh: "Refresh",
      agent_level: "Agent-level",
      workspace_level: "Workspace",
      global_level: "Global",
      not_set: "Not set",
      overrides_inherited: "Overrides inherited",
      agent: "Agent",
      loading_agents: "Loading agents...",
      no_agents: "No agents found",
    },

    // -- Quality Gates ----------------------------------------------------
    quality_gates: {
      title: "Quality Gates",
      loading: "Loading...",
      error_loading: "Error loading config",
      active_rules: "{count} active filter rules",
      loading_config: "Loading quality gate configuration...",
      description: "Quality gates filter AI-generated memories and reviews during execution dispatch. Patterns are matched as substrings against the combined title and content of each submission. When a pattern matches, the configured action is applied. These rules prevent operational noise (credential errors, stack traces, empty workspace reports) from polluting your knowledge base.",
      memory_filters: "Memory Filters",
      memory_filters_desc: "Applied to AgentMemory submissions. Blocks operational failures and credential leaks from being stored as persona memories.",
      review_filters: "Review Filters",
      review_filters_desc: "Applied to ManualReview submissions. Filters infrastructure errors so only genuine business decisions reach the review queue.",
      rejected_categories: "Rejected categories",
      rules_count: "{count} rule",
      rules_count_plural: "{count} rules",
      reset_defaults: "Reset to defaults",
      confirm_reset: "Confirm reset?",
      rules_hint: "Rules are loaded from the database on each dispatch. Changes take effect immediately.",
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

    // -- AppearanceStep --
    // Heading and description for the preference-setup step
    appearance_heading: "Set up your preferences",
    appearance_description: "Configure language, text size, and theme. You can change these anytime in Settings.",
    // Labels for the language, text size, and brightness sub-sections
    language_label: "Language",
    text_size_label: "Text Size",
    dark_label: "Dark",
    light_label: "Light",
    brightness_label: "Brightness",
    brightness_hint: "If the app feels too dark on your monitor, increase brightness.",

    // -- DesktopDiscoveryStep --
    scanning_desktop: "Scanning your desktop...",
    approved: "Approved",
    approve: "Approve",

    // -- ExecutionStep --
    run_first_agent: "Run your first agent",
    // {name} = the agent name
    execute_description: "Execute {name} and see real-time output.",
    agent_ready_hint: "Your agent is ready. Click below to start the first execution and see it in action.",
    run_agent: "Run Agent",
    execution_completed: "Execution completed successfully",
    executing: "Executing...",
    agent_output: "Agent Output",
    waiting_for_output: "Waiting for output...",
    execution_failed: "Failed to start execution",

    // -- TemplatePickerStep --
    loading_templates: "Loading templates...",
    no_templates: "No starter templates found.",
    no_templates_hint: "Generate templates first from the Templates section.",
    pick_template_heading: "Pick a starter template",
    pick_template_description: "Choose one of these popular templates to create your first agent.",
    // Connector overflow indicator; {count} = number of additional connectors
    more_connectors: "+{count} more",

    // -- OnboardingProgressBar --
    getting_started: "Getting Started",
    // Progress bar step labels
    progress_appearance: "Look & feel",
    progress_discover: "Detect desktop apps",
    progress_pick_template: "Pick template",
    progress_adopt: "Adopt agent",
    progress_execute: "First run",

    // -- GuidedTour --
    // {current} = current step number, {total} = total steps
    tour_step_of: "Step {current} of {total}",
    minimize: "Minimize",
    end_tour: "End tour",

    // -- TourPanelBody --
    back: "Back",
    complete_tour: "Complete Tour",
    tour_loading: "Loading...",
    tour_skip: "Skip",
    // GenericStepContent
    what_to_explore: "What to explore",
    auto_complete_hint: "Spend a moment exploring — this step will complete automatically, or click Skip to continue.",

    // -- TourLauncher --
    // {completed} = completed count, {total} = total steps
    resume_tour: "Resume Tour ({completed}/{total})",
    start_tour: "Start Tour",

    // -- CredentialsTourContent --
    connector_count_stat: "200+ Built-in Connectors",
    connector_count_hint: "Pre-configured with auth fields and health checks",
    categories_label: "Categories",
    // {count} = number of categories browsed
    browsed_progress: "Browsed {count}/2",
    connection_types_label: "Connection Types",
    // Connection type labels and descriptions
    conn_api_key: "API Key / Token",
    conn_api_key_desc: "Standard authentication — paste your key and go.",
    conn_oauth: "OAuth 2.0",
    conn_oauth_desc: "Secure authorization flow — click to authorize, no secrets to manage.",
    conn_mcp: "MCP Protocol",
    conn_mcp_desc: "Model Context Protocol — connect AI tools via stdio or SSE transport.",
    conn_desktop: "Desktop Bridge",
    conn_desktop_desc: "Integrate directly with local apps — VS Code, Terminal, Docker.",
    connect_once: "Connect once, use across all agents",
    connect_once_hint: "Credentials are shared across your entire agent fleet. Set up a Slack connection once and every agent can use it.",

    // -- PersonaCreationCoach --
    describe_intent: "Describe what your agent should do. Be specific about the task, data sources, and desired output.",
    example_intents_label: "Example intents",
    intent_field_hint: "Type your intent in the field on the right, then click the launch button.",
    analyzing_hint: "The AI is analyzing your intent and may ask clarifying questions to refine the agent design.",
    // {count} = number of pending questions
    questions_waiting_one: "{count} question waiting",
    questions_waiting_other: "{count} questions waiting",
    answer_questions_hint: "Answer them in the matrix to shape your agent's design.",
    answers_help_hint: "Your answers help the AI choose the right connectors, triggers, and policies.",
    matrix_heading: "The 8-dimension agent matrix:",
    // {pct} = completeness percentage
    matrix_completeness: "{pct}% complete",
    // Matrix dimension labels
    dim_use_cases: "Use Cases",
    dim_use_cases_desc: "What workflows your agent handles",
    dim_connectors: "Connectors",
    dim_connectors_desc: "External services it integrates with",
    dim_triggers: "Triggers",
    dim_triggers_desc: "How and when it activates",
    dim_human_review: "Human Review",
    dim_human_review_desc: "When it needs your approval",
    dim_messages: "Messages",
    dim_messages_desc: "How it notifies you of results",
    dim_memory: "Memory",
    dim_memory_desc: "Conversation persistence across runs",
    dim_error_handling: "Error Handling",
    dim_error_handling_desc: "Fallback strategies on failures",
    dim_events: "Events",
    dim_events_desc: "Event subscriptions it listens to",
    // Test/promote
    all_tests_passed: "All tests passed!",
    promote_hint: "Your agent has been verified. Click \"Promote\" to make it production-ready.",
    some_tests_failed: "Some tests failed",
    refine_hint: "You can refine the agent and re-test, or skip this step for now.",
    testing_description: "Testing validates that your agent's tools work correctly with real APIs.",
    what_testing_checks: "What testing checks:",
    test_check_api: "Each tool connects to its target API",
    test_check_creds: "Credentials are valid and have correct permissions",
    test_check_format: "Response formats match expectations",
    run_test_hint: "Click \"Run Test\" in the matrix to verify, then promote to production.",
    agent_promoted: "Agent promoted!",
    agent_promoted_hint: "Your first agent is live. The tour is almost complete!",
    skip_build: "Skip build for now",

    // -- TourAppearanceContent --
    dark_themes: "Dark Themes",
    light_themes: "Light Themes",
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
  // -------------------------------------------------------------------
  //  SCHEDULES -- schedule timeline, frequency editor, recovery
  // -------------------------------------------------------------------
  schedules: {
    title: "Schedule Timeline",
    subtitle: "Aggregated view of all scheduled agent executions. Cron schedules use UTC.",
    engine_on: "Engine On",
    engine_off: "Engine Off",
    mock_schedule: "Mock Schedule",
    active_count: "{count} active",
    paused_count: "{count} paused",
    view_grouped: "Grouped",
    view_timeline: "Timeline",
    view_calendar: "Calendar",
    loading_schedules: "Loading schedules...",
    no_scheduled_agents: "No scheduled agents",
    no_scheduled_hint: "Create a cron or polling trigger on any agent to see its schedule here. Missed runs are recovered automatically on startup.",
    showing_for: "Showing schedules for",
    loading_calendar: "Loading calendar...",

    // ScheduleRow health labels
    healthy: "Healthy",
    degraded: "Degraded",
    failing: "Failing",
    paused: "Paused",
    idle: "Idle",
    headless: "headless",
    run_now: "Run now",
    change_frequency: "Change frequency",
    pause_schedule: "Pause schedule",
    resume_schedule: "Resume schedule",

    // FrequencyEditor
    change_frequency_title: "Change Frequency",
    current_prefix: "Current: ",
    quick_presets: "Quick presets",
    cron_expression: "Cron expression",
    interval_seconds: "Interval (seconds)",
    previewing: "Previewing...",
    next_runs: "Next runs",
    invalid_cron: "Invalid cron expression",
    overlap_warning: "This schedule overlaps with {count} other execution(s) in the next 7 days. Concurrent agents compete for API quota and system resources.",

    // SkippedRecoveryPanel
    agents_missed: "{count} agent(s) missed executions",
    total_skipped: "~{count} total runs skipped while app was offline",
    recover: "Recover",
    run_1x: "Run 1x",
    skip: "Skip",
    dismiss_all: "Dismiss all",
    recover_selected: "Recover {count} selected",

    // ScheduleCalendar
    today: "Today",
    projected: "Projected",
    success: "Success",
    overlap: "Overlap",
    week: "Week",
    month: "Month",
  },

  recipes: {
    no_match: "No matching recipes",
    empty: "No recipes yet",
    no_match_hint: "Try a different search term.",
    empty_hint: "Create your first reusable LLM recipe to get started.",

    // RecipeManager
    title: "Recipes",
    new_recipe: "New Recipe",
    search_placeholder: "Search recipes... (Ctrl+K)",

    // RecipeCard
    run_quick_test: "Run quick test",
    edit_recipe: "Edit recipe",
    open_settings: "Open settings",
    delete_recipe: "Delete recipe",
    confirm_delete: "Confirm Delete",

    // RecipeList
    running_quick_test: "Running quick test...",
    quick_test_result: "Quick Test Result",

    // RecipeEditor
    save_changes: "Save Changes",
    create_recipe: "Create Recipe",
    name_label: "Name *",
    name_placeholder: "e.g. Summarize PR Changes",
    description_label: "Description",
    description_placeholder: "What does this recipe do?",
    category_label: "Category",
    prompt_template_label: "Prompt Template *",
    prompt_template_help: "Use {{variable}} syntax for placeholders that will be filled from input schema.",
    input_schema_label: "Input Schema",
    input_schema_help: "Define input fields with key, type, and label. Drag to reorder.",
    tags_label: "Tags",

    // RecipePlaygroundModal tabs
    tab_overview: "Overview",
    tab_test_runner: "Test Runner",
    tab_history: "History",
    tab_versions: "Versions",

    // RecipeOverviewTab
    details: "Details",
    category: "Category",
    created: "Created",
    tags: "Tags",
    input_fields: "Input Fields",
    prompt_template: "Prompt Template",
    col_key: "Key",
    col_type: "Type",
    col_label: "Label",

    // RecipeInputSection
    input: "Input",
    load_mock: "Load Mock",
    save_mock: "Save Mock",
    saved: "Saved",
    execute: "Execute",
    rendering: "Rendering...",
    executing: "Executing...",
    test_input: "Test Input",
    saved_mock_values: "Saved Mock Values",
    no_mock_values: "No mock values saved",
    free_input_placeholder: "Enter input JSON or plain text...",

    // RecipeOutputSection
    rendered_prompt: "Rendered Prompt",
    execution_result: "Execution Result",
    rendering_prompt: "Rendering prompt...",
    run_to_see_prompt: "Run the recipe to see the rendered prompt.",
    execute_to_see_output: "Execute the recipe to see LLM output.",
    waiting_for_render: "Waiting for prompt render...",

    // RecipeHistoryTab
    no_executions: "No executions yet. Run the recipe in the Test Runner tab.",
    recent_runs: "Recent Runs",

    // RecipeVersionsTab
    create_new_version: "Create New Version",
    what_changes: "What changes do you want to make?",
    changes_placeholder: "e.g., Add error handling for rate limits, include retry logic...",
    generate_new_version: "Generate New Version",
    generating_version: "Generating new version...",
    generated_version: "Generated Version",
    changes: "Changes",
    updated_prompt: "Updated Prompt Template",
    accept_apply: "Accept & Apply",
    regenerate: "Regenerate",
    version_history: "Version History",
    loading_versions: "Loading versions...",
    no_versions: "No versions yet. Generate a new version to start tracking changes.",
    latest: "Latest",
    revert_to_version: "Revert to this version",

    // RecipePicker
    link_recipe: "Link Recipe",
    search_recipes: "Search recipes...",
    all_linked: "All recipes are already linked.",
    no_matching: "No matching recipes found.",

    // LinkedRecipesSection
    loading_linked: "Loading linked recipes...",
    no_linked: "No recipes linked yet. Click \"Add\" to link recipes from the library.",
    run: "Run",
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
  // Plugins — shared plugin strings and per-plugin sections
  // ==========================================================================
  plugins: {
    // PluginBrowsePage
    title: "Plugins",
    subtitle: "Extend your workspace with plugins. Toggle to show or hide from the sidebar.",
    artist_label: "Artist",
    artist_desc: "Generate 3D models with Blender, create images with Leonardo AI, and manage creative assets.",
    dev_tools_label: "Dev Tools",
    dev_tools_desc: "Project management, context mapping, idea scanning, triage, and task runner utilities.",
    doc_signing_label: "Doc Signing",
    doc_signing_desc: "Sign and verify documents with digital signatures directly from your workspace.",
    obsidian_brain_label: "Obsidian Brain",
    obsidian_brain_desc: "Connect your Obsidian vault for knowledge retrieval, note browsing, and sync.",
    ocr_label: "OCR",
    ocr_desc: "Extract text from images and PDFs using Gemini Vision or Claude multimodal.",

    artist: {
      title: "Artist",
      subtitle: "Generate 3D models, create images, and manage creative assets",
      tab_creative_studio: "Creative Studio",
      tab_gallery: "Gallery",
      tab_media_studio: "Media Studio",
      creative_studio_title: "Creative Studio",
      creative_studio_desc: "Generate 3D models with Blender MCP, create images with Leonardo AI, and analyze with Gemini \u2014 all from one session.",
      env_status: "Environment Status",
      ready: "Ready",
      refresh: "Refresh",
      checking_env: "Checking environment...",
      not_found: "Not found",
      install_from_blender: "Install from blender.org",
      installed: "Installed",
      not_installed: "Not installed",
      installing: "Installing...",
      install: "Install",
      image_gen_tools: "Image Generation Tools",
      connected_healthy: "Connected & healthy",
      connected_not_verified: "Connected (not verified)",
      not_connected: "Not connected",
      connect: "Connect",
      creative_session: "Creative Session",
      streaming: "streaming",
      no_tools_connected: "No tools connected",
      clear_session: "Clear session",
      empty_session_hint: "Describe what you'd like to create. The session uses Claude CLI with access to your connected creative tools.",
      example_forest: "Create a low-poly forest scene in Blender",
      example_portrait: "Generate a cyberpunk character portrait",
      example_mockup: "Design a product mockup with lighting",
      describe_create: "Describe what to create...",
      connect_tools_first: "Connect tools above to start creating...",
      cancel: "Cancel",
      delete: "Delete",
      edit_tags: "Edit Tags",
      tags_prompt: "Tags (comma-separated):",
      mode_2d: "2D Images",
      mode_3d: "3D Models",
      search: "Search...",
      sort_date: "Date",
      sort_name: "Name",
      sort_size: "Size",
      scanning: "Scanning...",
      scan_folder: "Scan Folder",
      watching: "Watching:",
      loading_assets: "Loading assets...",
      no_images_yet: "No images yet",
      no_models_yet: "No models yet",
      scan_import_images_hint: "Click \"Scan Folder\" to import images from your Artist folder, or create them using the Blender Studio tab.",
      scan_import_models_hint: "Click \"Scan Folder\" to import 3D models from your Artist folder, or create them using the Blender Studio tab.",
      auto_rotate: "Auto-rotate",
      wireframe: "Wireframe",
      lighting_studio: "Studio",
      lighting_outdoor: "Outdoor",
      lighting_soft: "Soft",
      preview_not_available: "Preview not available",
      preview_glb_hint: "Only .glb and .gltf files can be previewed inline. Export from Blender as glTF for best compatibility.",
      viewer_3d: "3D Viewer",
      viewer_3d_hint: "Install @react-three/fiber and @react-three/drei to enable interactive 3D previews with orbit controls.",
      tags_label: "Tags:",
    },

    dev_tools: {
      no_project_configured: "No dev project configured",
      create_project_hint: "Create a project first to use scanner tools.",
      create_project: "Create Project",
      select_project: "Select a project...",
      context_map_title: "Context Map",
      context_map_subtitle: "Scan codebases into business-feature contexts",
      group: "Group",
      scan_codebase: "Scan Codebase",
      files: "files",
      keywords: "Keywords",
      entry_points: "Entry Points",
      no_context_groups: "No context groups yet",
      scan_or_create: "Scan your codebase or create groups manually",
      add_group: "Add Group",
      group_name_placeholder: "Group name...",
      create: "Create",
      no_contexts_in_group: "No contexts in this group yet",
      scanning_codebase: "Scanning Codebase",
      analyzing_codebase: "Claude is analyzing your codebase...",
      cancel_scan: "Cancel scan",
      waiting_for_output: "Waiting for output...",
      start_competition: "Start a Competition",
      competition_desc: "Spawn 2\u20134 competitors with different strategies, each in a Claude Code worktree.",
      task_title: "Task title",
      task_description: "Task description (optional)",
      strategy_slots: "Strategy slots (pick 2\u20134)",
      cost_warning: "Cost warning:",
      cost_warning_detail: "each competitor runs the full task independently (~$0.80 per Claude run). A 4-slot competition \u2248 $3.20 in API costs.",
      competitions: "Competitions",
      new_competition: "New Competition",
      no_competitions: "No competitions yet. Start one to have 2\u20134 Dev Clone variants race on the same task in parallel worktrees.",
      active: "Active",
      past: "Past",
      select_project_for_competitions: "Select a project to see competitions.",
      loading_competitors: "Loading competitors...",
      failed_to_load_detail: "Failed to load detail.",
      task: "Task",
      pick_winner: "Pick winner",
      winner: "Winner",
      cancel_competition: "Cancel competition",
      no_goals_constellation: "No goals yet. Create goals in the Projects tab to see the constellation.",
      your_turn: "Your Turn",
      agents_turn: "Agent's Turn",
      done: "Done",
      no_goals_kanban: "No goals yet. Create goals to see them here.",
      no_goals_here: "No goals here",
      lifecycle_title: "Dev Lifecycle",
      lifecycle_subtitle: "Autonomous development flow: scan \u2192 goals \u2192 review \u2192 build \u2192 learn",
      teardown: "Teardown",
      auto_setup: "Auto-Setup",
      adopt_first: "Adopt Dev Clone first",
      loading_lifecycle: "Loading lifecycle status...",
      adopt_dev_clone: "Adopt Dev Clone",
      adopt_dev_clone_desc: "Dev Clone is an autonomous developer persona bundled with Personas. It scans your codebase every hour, proposes tasks for review, and builds on approval. Adopting the template creates the persona, registers its tools, and wires its triggers in a single step.",
      dev_project: "Dev project",
      github_repo: "GitHub repo",
      dev_clone_template: "Dev Clone template",
      linked: "linked",
      not_linked: "not linked",
      bundled: "bundled",
      none_selected: "none selected",
      needed_for_pr: "Needed for PR workflows",
      select_project_first: "Select a project first",
      adopt_now_note: "You can still adopt now \u2014 add the GitHub URL to the project later to enable PR workflows.",
      how_it_works: "How the Autonomous Flow Works",
      no_project_click_create: "No project \u2014 click to create",
      repo: "repo",
      no_repo: "no repo",
      cross_project_title: "Cross-Project Metadata Map",
      cross_project_desc: "Aggregated from existing context maps. Consumed by Codebases connector.",
      regenerate: "Regenerate",
      generate: "Generate",
      no_metadata_yet: "No metadata map generated yet",
      no_metadata_hint: "Click Generate to analyze all projects' context maps and build a rich cross-project metadata layer for the Codebases connector.",
      tech_distribution: "Tech Distribution",
      shared_keywords_desc: "Concepts present in multiple projects \u2014 signals where business tasks overlap.",
      project_similarity: "Project Similarity",
      capabilities: "Capabilities",
      top_keywords: "Top Keywords",
      database_tables: "Database Tables",
      api_surface: "API Surface",
      hot_directories: "Hot Directories",
      purpose: "Purpose",
      run_context_scan: "Run Context Map scan for this project to enable rich metadata extraction.",
      collapse: "Collapse",
      details: "Details",
      loading_repositories: "Loading repositories...",
      github_url: "GitHub URL",
      github_repository: "GitHub Repository",
      select_repository: "Select a repository...",
      filter_repositories: "Filter repositories...",
      no_repositories: "No repositories found",
      implementation_log: "Implementation Log",
      add_note_placeholder: "Add a note...",
      no_activity: "No activity yet",
      projects_title: "Projects",
      projects_subtitle: "Manage local development projects and goals",
      cross_project_map: "Cross-Project Map",
      new_project: "New Project",
      edit_project: "Edit Project",
      project_folder: "Project Folder",
      select_folder: "Select a folder...",
      browse: "Browse",
      project_name: "Project Name",
      auto_filled: "(auto-filled from folder)",
      project_type: "Project Type",
      project_type_hint: "(optional, visual only)",
      purpose_desc: "Purpose & Description",
      save_changes: "Save Changes",
      project_created: "Project Created",
      generate_context_map: "Generate Context Map",
      skip_for_now: "Skip for now",
      add_goal: "Add a goal...",
      add: "Add",
      no_goals_yet: "No goals yet. Add one below.",
      select_project_below: "Select a project below or create a new one",
      no_projects_yet: "No projects yet",
      create_first_project: "Create First Project",
      col_name: "Name",
      col_path: "Path",
      col_tech_stack: "Tech Stack",
      col_goals: "Goals",
      col_status: "Status",
      col_created: "Created",
      delete_project: "Delete Project",
      self_healing: "Self-Healing",
      auto_heal: "Auto-heal",
      heal: "Heal",
      task_runner_title: "Task Runner",
      task_runner_subtitle: "Batch execution queue for accepted tasks",
      new_task: "New Task",
      batch_from_accepted: "Batch from Accepted",
      start_batch: "Start Batch",
      cancel_all: "Cancel All",
      batch_progress: "Batch Progress",
      task_queue: "Task Queue",
      no_tasks: "No tasks in queue",
      no_tasks_hint: "Create tasks manually or batch from accepted ideas",
      title_label: "Title",
      description_label: "Description",
      task_depth: "Task Depth",
      goal_link: "Goal Link",
      create_task: "Create Task",
      campaign: "Campaign",
      deep_build: "Deep Build",
      idea_evolution: "Idea Evolution",
      fitness_ranking: "Fitness Ranking",
      synthesis_suggestions: "Synthesis Suggestions",
      potential_duplicates: "Potential Duplicates",
      skills_title: "Skills",
      search_skills: "Search skills...",
      no_matching_skills: "No matching skills",
      no_skills_found: "No skills found",
      select_skill: "Select a skill to view its contents",
      edit: "Edit",
      save: "Save",
      file_empty: "File is empty or could not be loaded.",
      effort: "Effort",
      risk: "Risk",
      quick_wins: "Quick Wins",
      moderate: "Moderate",
      heavy: "Heavy",
      safe: "Safe",
      risky: "Risky",
      clear: "Clear",
      auto_triage_rules: "Auto-Triage Rules",
      new_rule: "New Rule",
      run_rules: "Run Rules",
      add_condition: "+ Add condition",
      accept: "Accept",
      reject: "Reject",
    },

    doc_signing: {
      title: "Document Signing",
      subtitle: "Ed25519 digital signatures with portable sidecar verification",
      tab_sign: "Sign",
      tab_verify: "Verify",
      tab_history: "History",
      sign_heading: "Sign a Document",
      sign_desc: "Create an Ed25519 digital signature using your local identity key. The signature is stored locally and a portable .sig.json sidecar is generated.",
      signing_as: "Signing as",
      choose_file_sign: "Choose file to sign",
      notes_label: "Notes (optional)",
      sign_document: "Sign Document",
      signing: "Signing...",
      signed_success: "Signed successfully",
      save_sig_json: "Save .sig.json",
      copy: "Copy",
      verify_heading: "Verify a Signature",
      verify_desc: "Check that a document has not been tampered with and that the signature is cryptographically valid.",
      choose_file_verify: "Choose file to verify",
      signature_label: "Signature (.sig.json)",
      load_from_file: "Load from file",
      verify_signature: "Verify Signature",
      verifying: "Verifying...",
      valid_signature: "Valid signature",
      verification_failed: "Verification failed",
      signer: "Signer",
      signed_at: "Signed at",
      file_integrity: "File integrity",
      unchanged: "Unchanged",
      modified: "Modified",
      crypto_signature: "Crypto signature",
      valid: "Valid",
      invalid: "Invalid",
      history_heading: "Signature History",
      no_signatures: "No signatures yet",
      no_signatures_hint: "Sign a document to see it here.",
      export_sig: "Export .sig.json",
      delete_signature: "Delete signature",
    },

    obsidian_brain: {
      title: "Obsidian Brain",
      subtitle: "Bidirectional sync between your Obsidian vault and Personas",
      tab_setup: "Setup",
      tab_sync: "Sync",
      tab_browse: "Browse Vault",
      tab_cloud: "Cloud",
      filter_notes: "Filter notes...",
      vault_empty: "Vault is empty",
      failed_to_load: "Failed to load",
      open_in_obsidian: "Open in Obsidian",
      no_vault_connected: "No Vault Connected",
      no_vault_hint: "Set up an Obsidian vault in the Setup tab first.",
      no_vault_cloud_hint: "Set up a local Obsidian vault in the Setup tab first, then connect Google Drive for cloud backup.",
      sign_in_required: "Sign In Required",
      sign_in_hint: "Sign in with your Google account to enable cloud sync. Your vault files will be stored in your own Google Drive (15 GB free).",
      google_drive_connection: "Google Drive Connection",
      drive_connected: "Drive Connected",
      connect_google_drive: "Connect Google Drive",
      connecting: "Connecting...",
      storage: "Storage",
      drive_info: "Connect Google Drive to back up your vault across devices. Files are stored in your own Google Drive under Personas/ObsidianSync/. Free alternative to Obsidian Sync ($4/month).",
      cloud_sync: "Cloud Sync",
      push_to_drive: "Push to Drive",
      pushing: "Pushing...",
      pull_from_drive: "Pull from Drive",
      pulling: "Pulling...",
      push_pull_hint: "Push uploads local vault changes to Google Drive. Pull downloads remote changes to your local vault. Only files that have changed since the last sync are transferred.",
      last_sync_result: "Last Sync Result",
      how_it_works: "How it works",
      step1_title: "Connect Google Drive",
      step1_desc: "Grant Personas access to create files in your Drive. Only the app's own folder is accessible.",
      step2_title: "Push your vault",
      step2_desc: "Vault notes are uploaded as markdown files to Drive. Only changed files are synced (content-hash comparison).",
      step3_title: "Sync across devices",
      step3_desc: "Pull on another device to download. Your 15 GB free Google Drive storage is more than enough for thousands of notes.",
      vault_connection: "Vault Connection",
      vault_connection_subtitle: "Connect to an Obsidian vault for bidirectional sync",
      detecting: "Detecting...",
      auto_detect: "Auto-Detect Vaults",
      detected_vaults: "Detected vaults:",
      vault_path_placeholder: "Vault path...",
      test: "Test",
      sync_options: "Sync Options",
      sync_options_subtitle: "Choose what data to synchronize",
      memories: "Memories",
      memories_desc: "Persona memories with category, importance, and tags",
      persona_profiles: "Persona Profiles",
      persona_profiles_desc: "System prompts, config, and design context",
      connectors: "Connectors",
      connectors_desc: "Connector definitions and service documentation",
      auto_sync: "Auto-Sync",
      auto_sync_desc: "Automatically push changes when memories are created",
      folder_structure: "Folder Structure",
      folder_structure_subtitle: "Customize how data is organized in your vault",
      personas_folder: "Personas Folder",
      memories_subfolder: "Memories Subfolder",
      connectors_folder: "Connectors Folder",
      save_configuration: "Save Configuration",
      saving: "Saving...",
      sync_actions: "Sync Actions",
      push_to_vault: "Push to Vault",
      pull_from_vault: "Pull from Vault",
      select_personas_push: "Select personas to push",
      select_all: "Select all",
      no_personas_found: "No personas found",
      last_push_result: "Last Push Result",
      app_version: "App Version",
      vault_version: "Vault Version",
      keep_app: "Keep App",
      keep_vault: "Keep Vault",
      skip: "Skip",
      sync_log: "Sync Log",
      no_sync_activity: "No sync activity yet. Push or pull to start.",
      select_note: "Select a Note",
      select_note_hint: "Choose a note from the tree on the left to preview its contents.",
    },

    ocr: {
      title: "OCR",
      subtitle: "Extract and compare text from images and documents",
      tab_extract: "Extract",
      tab_compare: "Compare",
      tab_history: "History",
      choose_image_pdf: "Choose image or PDF",
      gemini_vision: "Gemini Vision",
      claude_vision: "Claude Vision",
      extract_text: "Extract Text",
      extract_desc: "Upload an image or PDF and extract text using Gemini Vision API or Claude Code CLI.",
      custom_prompt: "Custom prompt (optional)",
      extracting: "Extracting...",
      extraction_complete: "Extraction complete",
      copy_text: "Copy text",
      compare_heading: "Side-by-Side Comparison",
      compare_desc: "Run both providers on the same file and compare outputs. Gemini uses API key, Claude uses your subscription.",
      running_both: "Running both providers...",
      compare: "Compare",
      no_gemini_key: "No Gemini API key provided",
      gemini_failed: "Gemini failed or still running",
      claude_running: "Claude still running or failed",
      comparison_stats: "Comparison Stats",
      history_heading: "OCR History",
      no_results: "No OCR results yet",
      no_results_hint: "Extract text from a document to see it here.",
    },
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
    // Obsidian vault picker label on project form
    obsidian_vault: "Obsidian vault",
    // Placeholder shown when no vault is linked
    obsidian_vault_hint: "Link an Obsidian vault to sync experiments and findings",
    // Button to select a vault folder via native dialog
    select_vault: "Select vault",
    // Badge shown when vault is connected
    vault_connected: "Vault connected",
    // Button to sync experiments to Obsidian vault
    sync_to_obsidian: "Sync to Obsidian",
    // Button label while sync is in progress
    syncing: "Syncing...",
    // Toast after successful sync
    sync_complete: "Synced to Obsidian",
    // Ingest button for KB ingestion on source cards
    ingest_to_kb: "Ingest to KB",
    // Label for daily note sync
    daily_note_sync: "Daily note sync",
    // Status label for sources being ingested
    source_indexed: "Indexed",

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

  // -------------------------------------------------------------------
  //  EXECUTION -- user-facing execution messages (executionSlice.ts)
  // -------------------------------------------------------------------
  execution: {
    budget_exceeded: "Monthly budget exceeded for this agent. Override the budget pause in the agent settings or increase the budget to continue.",

    // -- ExecutionMiniPlayer --
    // Shown when an execution error occurs during simple mode progress
    something_went_wrong: "Something went wrong",
    // Status labels at the end of an execution
    failed: "Failed",
    complete: "Complete",
    // Button to copy entire execution output
    copy_full_output: "Copy full output",
    // Tooltip for the stop button
    stop_execution: "Stop execution",
    // Tooltip for collapse/expand toggle
    collapse: "Collapse",
    expand: "Expand",
    // Tooltip for unpin button
    unpin_mini_player: "Unpin mini-player",
    // Label shown above the pipeline dots
    pipeline: "Pipeline",
    // Suffix shown after line count, e.g. "42 lines"
    lines: "lines",
    // Shown when waiting for output to arrive
    waiting_for_output: "Waiting for output...",
    // Shown when there is no output
    no_output: "No output",
    // Label for the background executions section
    background: "Background",
  },

  // -------------------------------------------------------------------
  //  GITLAB -- GitLab CI/CD integration (src/features/gitlab/)
  // -------------------------------------------------------------------
  gitlab: {
    // -- GitLabPanel header --
    // Panel title
    integration_title: "GitLab Integration",
    // Panel subtitle
    integration_subtitle: "Deploy personas as GitLab Duo Agents",

    // -- GitLabPanel tab labels --
    tab_connection: "Connection",
    tab_deploy: "Deploy",
    tab_agents: "Agents",
    tab_history: "History",
    tab_gitops: "GitOps",
    tab_pipelines: "Pipelines",

    // -- GitLabConnectionForm --
    // Heading for the credential section
    gitlab_credential: "GitLab Credential",
    // Shown when a credential is found in the vault
    using_credential: "Using {name} from Vault",
    // Label for the instance URL field
    instance_url: "Instance URL",
    // Instance URL placeholder text
    instance_url_placeholder: "https://gitlab.com",
    // Help text under the instance URL field
    instance_url_help: "Leave empty for gitlab.com, or enter your self-hosted instance URL",
    // Connected state text: "Connected as @{username}"
    connected_as: "Connected as @{username}",
    // Button labels
    connect_to_gitlab: "Connect to GitLab",
    connecting: "Connecting...",
    disconnect: "Disconnect",
    // Shown when no credential found
    no_pat_found: "No GitLab PAT found in your Credential Vault. Add one to connect.",
    add_gitlab_credential: "Add GitLab Credential",

    // -- GitLabDeployModal --
    // Form field labels
    target_project: "Target Project",
    select_project: "Select a project...",
    persona_to_deploy: "Persona to Deploy",
    select_persona: "Select a persona...",
    // Creating from template message
    creating_from_template: "Creating persona from template...",
    // Credential provisioning toggle
    provision_api_credentials: "Provision API credentials",
    provision_description: "Securely push this persona's tool credentials to the GitLab project as masked CI/CD variables. The agent will access them as environment variables at runtime.",
    provision_security_note: "Credentials are transmitted over HTTPS and stored as masked, protected variables. They will not appear in job logs or the system prompt.",
    // Version-controlled deploy toggle
    version_controlled_deploy: "Version-controlled deploy",
    version_description: "Tag this deployment as a versioned release. Enables rollback to any previous version from the GitOps tab.",
    target_environment: "Target environment (optional)",
    no_environment: "No environment",
    // Deploy button
    deploying: "Deploying...",
    deploy_to_gitlab: "Deploy to GitLab",
    // Deploy result
    deployed_successfully: "Deployed successfully via {method}",
    agent_id: "Agent ID: {id}",
    credentials_provisioned: "{count} credential{count, plural, one {} other {s}} provisioned as CI/CD variables",
    view_in_gitlab: "View in GitLab",

    // -- GitLabAgentList --
    select_project_to_view_agents: "Select a project in the Deploy tab to view agents.",
    no_duo_agents: "No Duo Agents deployed",
    deploy_persona_hint: "Deploy a persona from the Deploy tab",
    agents_deployed: "{count} agent(s) deployed",
    // Button titles
    redeploy_agent: "Redeploy agent",
    open_in_gitlab: "Open in GitLab",
    undeploy_agent: "Undeploy agent",
    latest_pipeline: "Latest pipeline: {status}",

    // -- DeploymentHistoryTab --
    select_project_for_history: "Select a project in the Deploy tab to view deployment history.",
    filter_by_persona: "Filter by Persona",
    all_personas: "All personas",
    deployment_timeline: "Deployment Timeline",
    deployment_count: "{count} deployment{count, plural, one {} other {s}}",
    loading_deployment_history: "Loading deployment history...",
    no_deployments: "No deployments recorded yet",
    deploy_to_build_history: "Deploy a persona to start building deployment history",
    current: "Current",
    rollback: "Rollback",
    duo_agent_api: "Duo Agent API",
    agents_md: "AGENTS.md",
    credential_provisioned_count: "{count} credential{count, plural, one {} other {s}} provisioned",
    confirm_rollback: "Confirm",
    rollback_to_deployment: "Rollback to this deployment",

    // -- GitOpsVersionHistory --
    select_project_for_versions: "Select a project in the Deploy tab to view version history.",
    persona_label: "Persona",
    environment_branches: "Environment Branches",
    branch_count: "{count} branch{count, plural, one {} other {es}}",
    no_environment_branches: "No environment branches yet",
    create_branches: "Create dev / staging / production",
    protected_branch: "Protected branch",
    version_history: "Version History",
    loading_version_history: "Loading version history...",
    no_versions: "No versions deployed yet",
    deploy_with_versioning: "Deploy this persona with versioning enabled to start tracking history",
    confirm_rollback_version: "Confirm rollback",
    rollback_to_version: "Rollback to {version}",

    // -- GitLabPipelineViewer --
    select_project_for_pipelines: "Select a project in the Deploy tab to view pipelines.",
    pipeline_count: "{count} pipeline(s)",
    no_pipelines: "No pipelines",
    trigger_pipeline: "Trigger Pipeline",
    no_pipelines_yet: "No pipelines yet",
    trigger_to_start: "Trigger a pipeline to get started",
    pipeline_number: "Pipeline #{id}",
    refresh_pipeline: "Refresh pipeline",
    no_jobs_found: "No jobs found",
    select_pipeline_to_view: "Select a pipeline to view jobs",

    // -- JobRow --
    loading_log: "Loading log...",
    no_log_output: "No log output",

    // -- NotificationCenter --
    notifications: "Notifications",
    mark_all_read: "Mark all as read",
    clear_all: "Clear all",
    close_notification_center: "Close notification center",
    no_notifications_yet: "No notifications yet",
    pipeline_status_hint: "Pipeline status changes will appear here as they happen.",
    just_now: "just now",
    minutes_ago: "{mins}m ago",
    hours_ago: "{hrs}h ago",
    yesterday: "yesterday",
    days_ago: "{days}d ago",
    status_succeeded: "Succeeded",
    status_failed: "Failed",
    status_canceled: "Canceled",
    status_warning: "Completed with warning",
    human_review: "Human Review",
    go_to_approvals: "Go to Approvals",
    view_logs: "Logs",

    // -- PipelineNotificationPrefs --
    pipeline_notifications: "Pipeline Notifications",
    enable_pipeline_notifications: "Enable pipeline notifications",
    notification_description: "Get notified when a pipeline finishes running.",
    success_label: "Success",
    failed_label: "Failed",
    canceled_label: "Canceled",
    play_sound: "Play sound",

    // -- CiCdTemplatesPicker --
    cicd_agent_templates: "CI/CD Agent Templates",
    your_tier: "(yours)",
  },

  // -------------------------------------------------------------------
  //  PIPELINE -- team canvas, pipeline nodes (src/features/pipeline/)
  // -------------------------------------------------------------------
  pipeline: {
    // -- TeamList header --
    agent_teams: "Agent Teams",
    agent_teams_subtitle: "Design multi-agent pipelines with visual canvas",
    auto_team: "Auto-Team",
    new_team: "New Team",
    create_blank_team: "Create Blank Team",
    no_teams_yet: "No teams yet",
    no_teams_hint: "Start from a template below or create a blank team",

    // -- CreateTeamForm --
    team_name: "Team Name",
    team_name_placeholder: "e.g. Code Review Pipeline",
    team_description_placeholder: "Optional description",
    color: "Color",
    create_team: "Create Team",

    // -- TeamCard --
    fork_team: "Fork team",
    forked_from: "forked from {name}",
    forked_from_deleted: "forked from deleted team",
    active: "active",
    draft: "draft",

    // -- TeamConfigPanel --
    configure: "Configure",
    view_persona: "View persona",
    model_label: "Model",
    tools_label: "Tools",
    triggers_label: "Triggers",
    connectors_label: "Connectors",
    last_run: "Last run",
    role: "Role",
    remove_confirm: "Remove \"{name}\" from team?",
    remove_from_team: "Remove from Team",

    // -- TeamDragPanel --
    drag_to_canvas: "Drag to canvas",
    added: "added",
    no_agents_created: "No agents created yet",

    // -- TeamToolbar --
    add_agent: "Add Agent",
    all_agents_added: "All agents already added",
    note: "Note",
    layout: "Layout",
    saving: "Saving...",
    saved: "Saved",

    // -- PipelineControls --
    execute: "Execute",
    running: "Running...",
    dry_run: "Dry Run",
    no_agents_in_pipeline: "No agents in pipeline",
    pipeline_failed: "Pipeline failed at step {step} of {total}",
    pipeline_completed: "Pipeline completed",
    step_progress: "Step {step} of {total}",
    ready_to_execute: "Ready to execute",
    runs_until_completion: "Runs until completion",

    // -- OptimizerPanel --
    topology_optimizer: "Topology Optimizer",
    suggestion_count: "{count} suggestion{count, plural, one {} other {s}}",
    run_count: "{count} run{count, plural, one {} other {s}}",
    success_rate: "{rate}% success",
    refresh_analytics: "Refresh analytics",

    // -- OptimizerResults --
    analyzing_pipeline: "Analyzing pipeline history...",
    run_pipeline_twice: "Run the pipeline at least twice",
    run_pipeline_twice_hint: "to generate optimization insights",
    topology_looks_good: "Topology looks good",
    no_improvements: "No improvements detected",
    accept_suggestion: "Accept suggestion",

    // -- NodeContextMenu --
    current_role: "current",

    // -- EdgeDeleteTooltip --
    connection_type: "Connection Type",
    delete_connection: "Delete Connection",

    // -- StickyNoteNode --
    decision: "Decision",
    todo: "TODO",
    warning: "Warning",
    docs: "Docs",
    note_placeholder: "Write a note (markdown supported)...",
    done: "Done",
    double_click_to_edit: "Double-click to edit...",

    // -- CanvasAssistant --
    assistant: "Assistant",
    canvas_assistant: "Canvas Assistant",
    describe_pipeline: "Describe your pipeline...",
    no_matching_agents: "No matching agents found. Create some agents first, then try again.",
    building_team: "Building your team...",
    blueprint_agents: "Blueprint -- {count} agents",
    applying: "Applying...",
    apply_to_canvas: "Apply to Canvas",
    build_pipeline: "Build Pipeline",

    // -- AutoTeamModal --
    auto_team_subtitle: "Describe an outcome, get a team",
    auto_team_placeholder: "What do you want the team to do?",
    generate_team: "Generate team",
    assembling_team: "Assembling your team...",
    try_different: "Try different",
    creating_team: "Creating team with {count} agents...",
    seeding_memories: "Seeding memories from similar teams...",
    team_created: "Team created",
    memories_seeded: "{count} memories seeded",
    open_team_canvas: "Open Team Canvas",
    try_again: "Try again",

    // -- BlueprintPreview --
    agent_count: "{count} agent{count, plural, one {} other {s}}",
    connection_count: "{count} connection{count, plural, one {} other {s}}",

    // -- PipelineTemplateGallery --
    starter_templates: "Starter Templates",
    nodes: "nodes",
    edges: "edges",
    use_template: "Use Template",

    // -- DryRunDebugger --
    cycle_detected: "Cycle detected",
    cycle_warning: "Execution order is arbitrary for: {nodes}. Consider removing circular connections or marking them as feedback edges.",

    // -- DebuggerControls --
    dry_run_label: "Dry Run",
    pause: "Pause",
    continue_label: "Continue",
    start: "Start",
    step_forward: "Step Forward",
    stop_dry_run: "Stop Dry Run",
    step_counter: "Step {current} / {total}",
    complete_label: "Complete",
    paused: "Paused",
    inspector: "Inspector",
    breakpoint_count: "{count} breakpoint{count, plural, one {} other {s}}",

    // -- DebuggerVariables --
    input: "Input",
    output: "Output",
    no_input_data: "No input data",
    awaiting_execution: "Awaiting execution",

    // -- TeamMemoryPanel / MemoryPanelHeader --
    team_memory: "Team Memory",
    list_view: "List view",
    timeline_view: "Timeline view",
    compare_runs: "Compare runs",
    avg_importance: "Avg importance: {value} | {count} categories",

    // -- AddTeamMemoryForm --
    add_memory: "Add Memory",
    new_memory: "New Memory",
    title_placeholder: "Title...",
    content_placeholder: "Content...",
    importance_label: "Imp:",
    save_memory: "Save Memory",

    // -- MemoryPanelList --
    search_memories: "Search memories...",
    clear_run_filter: "Clear run filter",
    no_memories_for_run: "No memories for this run",
    no_memories_yet: "No memories yet",
    try_clearing_filter: "Try clearing the run filter",
    run_pipeline_or_add: "Run a pipeline or add one manually",
    load_more: "Load more",
    showing_count: "Showing {shown} of {total}",
  },

  // -------------------------------------------------------------------
  //  AUTH -- authentication messages (authStore.ts)
  // -------------------------------------------------------------------
  auth: {
    login_timed_out: "Login timed out. Please try again.",
  },

  // -------------------------------------------------------------------
  //  SHARED -- shared UI components (src/features/shared/components/)
  // -------------------------------------------------------------------
  shared: {
    // -- display/BlastRadiusPanel --
    // Shown while computing which resources are affected by a deletion
    blast_checking_impact: "Checking impact...",
    // Shown when no resources depend on the item being deleted
    blast_safe_to_delete: "No dependent resources found. Safe to delete.",
    // Header label for the impact list
    blast_impact: "Impact",

    // -- display/DataGrid --
    // Default loading text shown while the grid fetches data
    grid_loading: "Loading...",
    // Default empty-state heading when no rows match
    grid_no_data: "No data",
    // Label shown next to the page-size selector
    grid_rows: "Rows",
    // Pagination summary: "Showing {start}--{end} of {total} items"
    grid_showing: "Showing {start}\u2013{end} of {total} items",
    // Accessible label for the page-size select element
    grid_rows_per_page: "Rows per page",

    // -- display/EmptyState (display) --
    // Empty-state variant headings and descriptions
    empty_chart_heading: "No traffic data yet",
    empty_chart_description: "Traffic and error metrics will appear here once your agents start processing requests.",
    empty_activity_heading: "No recent activity",
    empty_activity_description: "Run an agent to see execution activity here.",
    empty_alerts_heading: "No alerts triggered",
    empty_alerts_description: "Alerts will appear here when your monitoring rules fire.",
    empty_metrics_heading: "No execution data",
    empty_metrics_description: "Charts will populate once agents have completed executions.",

    // -- display/DesignConnectorGrid --
    // Section labels in the design connector grid
    connectors_and_tools: "Connectors & Tools",
    general_tools: "General Tools",
    events_and_triggers: "Events & Triggers",
    activates_persona: "What activates this persona",
    triggers: "Triggers",
    event_subscriptions: "Event Subscriptions",
    messages_and_notifications: "Messages & Notifications",
    communicates_persona: "How this persona communicates",
    // {connector} = the required connector name
    requires_connector: "Requires {connector}",

    // -- display/FieldHint --
    // Accessible label for the info icon button
    field_info: "Field info",
    // Labels inside the hint tooltip
    hint_range: "Range:",
    hint_example: "Example:",

    // -- display/GlossaryTooltip --
    // Plain-language definitions for technical terms
    glossary_webhook: "A URL that receives automatic notifications when something happens \u2014 like a mailbox for your app.",
    glossary_schema: "The expected shape of incoming data \u2014 which fields are required and what type they should be.",
    glossary_payload: "The actual data sent along with a request or event.",
    glossary_endpoint: "A specific address where your agent can be reached or send data.",
    glossary_json: "A common text format for structured data, using curly braces and key-value pairs.",
    glossary_api: "A way for two programs to talk to each other automatically.",
    glossary_credential: "A saved login or access key that lets the agent connect to an external service.",
    glossary_oauth: "A secure way to grant access without sharing your password.",

    // -- display/UnifiedTable --
    // Accessible title for the sort button: "Sort by {label}"
    sort_by: "Sort by {label}",
    // Accessible title for the filter button: "Filter {label}"
    filter_label: "Filter {label}",
    // Placeholder inside inline column search
    search_ellipsis: "Search...",
    // Accessible title for the search button: "Search {label}"
    search_label: "Search {label}",

    // -- display/UuidLabel --
    // Tooltip shown on the copy-ID button
    copy_full_id: "Copy full ID",

    // -- buttons/CopyButton --
    // Default tooltip for the copy button (idle state)
    copy_tooltip: "Copy",
    // Shown as label and tooltip in copied state
    copy_copied: "Copied",
    // Tooltip shown briefly after copying
    copy_copied_bang: "Copied!",

    // -- feedback/ConnectionStatusBadge --
    // Label when the connection is established
    connection_connected: "Connected",
    // Label when the connection is lost
    connection_disconnected: "Disconnected",
    // Shown during initial connection attempt
    connection_connecting: "Connecting...",
    // Shown during reconnection; {seconds} = countdown
    connection_reconnecting: "Reconnecting",
    // Title tooltip: "Reconnection attempt {attempt} -- retrying in {seconds}s"
    connection_reconnecting_title: "Reconnection attempt {attempt} \u2014 retrying in {seconds}s",

    // -- feedback/ErrorBanner --
    // Button label to navigate backwards
    go_back: "Go back",

    // -- feedback/ErrorBoundary --
    // Heading when a named component crashes: "Something unexpected happened in {name}"
    error_boundary_heading_named: "Something unexpected happened in {name}",
    // Heading when an unnamed component crashes
    error_boundary_heading: "Something unexpected happened",
    // Reassurance message below the heading
    error_boundary_reassurance: "Don't worry \u2014 your data is safe. You can try again or head back to the dashboard.",
    // Button to retry rendering
    error_boundary_try_again: "Try Again",
    // Button to navigate to the dashboard
    error_boundary_go_dashboard: "Go to Dashboard",
    // Label shown after copying crash report
    error_boundary_copied: "Copied to clipboard",
    // Label for copying crash report
    error_boundary_copy_report: "Copy report for support",
    // Toggle label for developer details
    error_boundary_for_devs: "For developers",
    // Fallback when no stack trace is available
    error_boundary_no_stack: "No stack trace available",

    // -- feedback/InlineErrorBanner --
    // Accessible label for the dismiss button
    inline_dismiss: "Dismiss",

    // -- feedback/SuspenseFallback --
    // Screen-reader label while lazy-loaded content is loading
    suspense_loading: "Loading",

    // -- feedback/ToastContainer --
    // Accessible label for the toast dismiss button
    toast_dismiss: "Dismiss notification",
    // Button label to resolve a healing issue
    toast_resolve: "Resolve",
    // Overflow count label: "+{count} more"
    toast_overflow: "+{count} more",

    // -- feedback/StalenessIndicator --
    // Time labels for staleness display
    staleness_just_now: "just now",
    // Title tooltip when a data section is stale
    // {label} = data section name, {age} = age string, {suffix} = " (refresh failed)" or ""
    staleness_title_labeled: "{label} data last updated {age}{suffix}",
    staleness_title: "Data last updated {age}{suffix}",
    staleness_refresh_failed: " (refresh failed)",

    // -- forms/KeyValueEditor --
    // Mode toggle labels
    kv_simple_mode: "Simple mode",
    kv_advanced_json: "Advanced (JSON)",
    // Placeholder for key and value inputs
    kv_label_placeholder: "Label",
    kv_value_placeholder: "Value",
    // Shown when duplicate keys are detected
    kv_duplicate_key: "Duplicate key",
    // Button to add a new key-value pair
    kv_add_field: "Add field",

    // -- forms/PersonaSelector --
    // Default placeholder for the persona selector
    persona_select: "Select persona",
    // Label for the "show all" option
    persona_all: "All Personas",
    // No results message: "No personas matching \"{query}\""
    persona_no_match: "No personas matching \u201c{query}\u201d",

    // -- forms/PersonaSelectorModal --
    // Modal header
    persona_modal_title: "Select Persona",

    // -- forms/DirectoryPickerInput --
    // Default placeholder for the directory input
    dir_placeholder: "Select a directory...",
    // Title for the native directory picker dialog
    dir_dialog_title: "Select output directory",
    // Button label
    dir_browse: "Browse",

    // -- forms/TableSelector --
    // Placeholder in the table filter input
    table_filter: "Filter tables...",
    // Toggle-all button labels
    table_deselect_all: "Deselect all",
    table_select_all: "Select all",
    // Loading state
    table_loading: "Loading tables...",
    // Empty states
    table_none_found: "No tables found",
    table_no_match: "No matching tables",
    // Footer summary: "{selected} of {total} table(s) selected"
    table_selected: "{selected} of {total} table selected",
    table_selected_plural: "{selected} of {total} tables selected",

    // -- forms/IconSelector --
    // Section headings in the icon picker
    icon_agent_icons: "Agent Icons",
    icon_connectors: "Connectors",
    icon_emoji: "Emoji",
    // Tooltip for the clear-icon button
    icon_clear: "Clear icon",

    // -- forms/AccessibleToggle --
    // Screen-reader text for toggle state
    toggle_enabled: "Enabled",
    toggle_disabled: "Disabled",

    // -- forms/DesignInput --
    // Drag overlay label
    design_drop_file: "Drop file here",
    // Textarea placeholder
    design_placeholder: "Describe what this persona should do...\n\nExamples:\n  - Monitor my Gmail for invoices and extract amounts into a spreadsheet\n  - Watch GitHub webhooks and post summaries to Slack\n  - Analyze our API logs daily and flag anomalies",
    // Action bar button labels
    design_attach: "Attach",
    design_references: "References",
    // File count: "{count} file(s) attached"
    design_files_attached_one: "{count} file attached",
    design_files_attached_other: "{count} files attached",
    // Submit hint
    design_submit_hint: "Press Enter to submit, Shift+Enter for new line.",

    // -- forms/DevToolsProjectDropdown --
    // Default placeholder
    devtools_select_project: "Select a project...",
    // Loading state labels
    devtools_loading_projects: "Loading projects...",
    devtools_loading: "Loading...",
    // Error message
    devtools_load_failed: "Failed to load projects",
    // Empty state
    devtools_no_projects: "No projects found",
    devtools_no_projects_hint: "Add a codebase project in Dev Tools first, then return here to select it.",
    devtools_no_projects_nav: "Navigate to Plugins \u2192 Dev Tools to create a project.",

    // -- layout/ProcessActivityDrawer --
    // Drawer header
    process_activity: "Process Activity",
    // Section labels
    process_action_required: "Action Required",
    process_active: "Active",
    process_queued: "Queued",
    process_recent: "Recent",
    // Empty state
    process_empty: "No active or recent processes",
    // Status labels
    process_in_queue: "#{position} in queue",
    process_input_required: "Input required",
    process_draft_ready: "Draft ready",
    // Cost detail: "{count} tool calls"
    process_tool_calls: "{count} tool calls",

    // -- overlays/ConfirmDestructiveModal --
    // Type-to-confirm instruction: "Type {name} to confirm"
    confirm_type_to_confirm: "Type {name} to confirm",

    // -- overlays/UnsavedChangesModal --
    // Modal heading
    unsaved_heading: "Save changes before leaving?",
    // Body text with sections named
    unsaved_body_sections: "You have unsaved changes in {sections}. These will be lost if you leave without saving.",
    // Body text without section names
    unsaved_body: "You have unsaved changes that will be lost if you leave without saving.",
    // Button labels
    unsaved_save: "Save and continue",
    unsaved_saving: "Saving\u2026",
    unsaved_discard: "Discard changes",
    unsaved_stay: "Stay on page",

    // -- overlays/CommandPalette --
    // Search input placeholder
    cmd_placeholder: "Search agents, credentials, templates... (type \">\" for commands)",
    // Footer navigation hints
    cmd_navigate: "navigate",
    cmd_select: "select",
    cmd_commands: "commands",
    draft_editor: { persona_name_placeholder: "Persona name...", description_placeholder: "Brief description...", refine_placeholder: "Example: Make error handling stricter, add retry logic...", name_label: "Name", name_input_placeholder: "Give your persona a name...", description_label: "Description", description_input_placeholder: "A brief description of what this persona does...", system_prompt_placeholder: "The core instructions for this persona...", custom_sections: "Custom Sections", remove_section: "Remove section", key_placeholder: "key", label_placeholder: "label", content_placeholder: "Section content...", icon_label: "Icon", color_label: "Color", design_context: "Design Context", design_context_placeholder: "Additional context about how this persona was designed...", design_context_json: "Design context JSON...", click_next: "Click next to proceed with the transform.", configure_transform: "Configure Transform", select: "Select..." },
    forms_extra: { references: "References", references_placeholder: "Paste URLs, connection strings, API keys, or any reference info (one per line)", remove_file: "Remove file", choose_color: "Choose color", choose_icon: "Choose icon", filter_placeholder: "Filter...", reset_to_default: "Reset to default" },
    reasoning_trace: { system_init: "System Init", reasoning: "Reasoning", tool_call: "Tool Call: {name}", result: "Result", complete: "Complete", error: "Error" },
    sidebar_extra: { agents: "Agents", schedules: "Schedules", remove_favorites: "Remove from favorites", add_favorites: "Add to favorites", active_project: "Active Project" },
    execution_detail: { copy: "Copy", suggested_actions: "Suggested Actions", knowledge_insight: "Knowledge Insight", outcome_assessment: "Outcome Assessment", blockers: "Blockers" },
    progress_extra: { taking_longer: "Taking longer than expected", complete: "Complete", resuming: "Resuming previous transformation session...", cancel_transformation: "Cancel transformation", draft_generated: "Draft generated successfully", transformation_failed: "Transformation failed", waiting_to_start: "Waiting to start transformation..." },
    terminal_extra: { press_enter: "Press Enter or click Play to start", connection_failed: "Connection failed -- check provider settings and retry", search_output: "Search output...", dismiss: "Dismiss" },
    use_cases_extra: { example_output: "Example output", input_data: "Input Data", rerun_input: "Re-run with this input", input_prefix: "Input: ", error_prefix: "Error: ", output_prefix: "Output: ", toggle_history: "Toggle execution history", configure_model: "Configure model, notifications & subscriptions" },
  },
};

export type Translations = typeof en;
