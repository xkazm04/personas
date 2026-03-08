/**
 * English translations for the Personas application.
 * 
 * Contextual comments are provided to assist with precise translations 
 * into other languages (Mandarin, Hindi, Arabic, Russian, Indonesian).
 */
export const en = {
  common: {
    loading: "Loading...",
    saving: "Saving...",
    deleting: "Deleting...",
    retry: "Retry",
    cancel: "Cancel",
    save: "Save",
    delete: "Delete",
    edit: "Edit",
    close: "Close",
    actions: "Actions",
    status: "Status",
    name: "Name",
    description: "Description",
    created: "Created",
    id: "ID",
    error: "Error",
    success: "Success",
    required: "required",
    select: "— select —",
    no_results: "No results found",
  },
  vault: {
    title: "Vault",
    subtitle: "Choose how you want to add a credential",
    add_from_catalog: "Add from catalog",
    ai_designed: "AI-designed credential",
    workspace_connect: "Workspace Connect",
    quick_start: "Quick start",
    health: {
      healthy: "healthy",
      needs_attention: "needs attention",
      untested: "untested",
    },
    list: {
      no_credentials: "No authenticated services detected. Select manually below.",
      delete_confirm: "Delete this credential?",
      blast_radius: "Blast Radius",
      no_dependencies: "No agents depend on this credential. Safe to modify or remove.",
      affected_agents: "Affected Agents",
      affected_events: "Affected Events",
    },
    import: {
      title: "Import Source",
      picker_subtitle: "Choose the source of your secrets",
      select_all: "Select all",
      deselect_all: "None",
      enable_sync: "Enable sync mode",
      source_ref: "Source reference",
      poll_interval: "Poll interval",
      intervals: {
        min15: "15 min",
        min30: "30 min",
        hour1: "1 hour",
        hour6: "6 hours",
        day1: "24 hours",
      }
    },
    features: {
      anomaly_detected: "Anomaly detected: credential suddenly failing after previous success. Possible revocation.",
      history: "History",
      event_triggers: "Event Triggers",
      rotation_policy: {
        rotate_every: "Rotate every",
        days: "days",
        no_policy: "No rotation policy configured.",
      },
      intelligence: {
        operation: "Operation",
        detail: "Detail",
        time: "Time",
      }
    },
    negotiator: {
      initializing: "Initializing negotiator...",
      prerequisites: "Prerequisites",
      all_steps_completed: "All steps completed",
      captured: "Credentials captured",
    }
  },
  deployment: {
    title: "Deployment",
    orchestrator_url: "Orchestrator URL",
    api_key: "API Key",
    connecting: "Connecting...",
    sr_connecting: "Connecting to cloud orchestrator...",
    auth_code: "Authorization Code",
    deploying: "Deploying...",
    sr_deploying: "Deploying persona to cloud",
    no_targets: "No deployment targets connected",
    status: {
      connected: "Connected",
      loading: "Loading cloud status...",
      token_available: "Token available",
      no_token: "No token configured",
    }
  },
  overview: {
    title: "Overview",
    no_output: "No output yet",
    no_background_jobs: "No background jobs running or recent",
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
    },
    realtime: {
      idle: "Idle — click {action} to simulate traffic",
      test_flow: "Test Flow",
      events_per_min: "events/min",
      pending: "pending",
      success: "success",
      in_window: "in window",
    },
    observability: {
      persona_disabled: "Persona auto-disabled",
      auto_resolved: "This issue was automatically resolved",
      mark_resolved: "Mark as Resolved",
      manual_fix: "(manual fix applied)",
      metrics_unavailable: "Metrics unavailable — data shown may be stale",
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
      }
    },
    executions: {
      title: "Executions",
      loading: "Loading executions...",
      no_agents: "No agents created yet",
      create_first: "Create your first agent to see execution activity here",
      no_executions: "No executions yet",
      run_agent: "Run an agent to see execution activity here",
    }
  },
  personas: {
    title: "Personas",
    loading: "Loading...",
  },
  settings: {
    title: "Settings",
  }
};

export type Translations = typeof en;
