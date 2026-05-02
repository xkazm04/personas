// TODO(i18n-bn): translate from English placeholders. Structure must match en.ts exactly.
export const bn = {
  overview: {
    trend: {
      up: "বৃদ্ধি",
      down: "হ্রাস",
      stable: "স্থিতিশীল — কোনো উল্লেখযোগ্য পরিবর্তন নেই",
      vs_previous: "পূর্ববর্তী সময়ের তুলনায়",
    },

    emptyState: {
      metrics_title: "আপনার এজেন্টগুলি এখনও চালানো হয়নি",
      metrics_subtitle: "আপনার এজেন্টগুলি প্রক্রিয়াকরণ শুরু করলে খরচ, বিলম্ব এবং সফলতার হারের মতো নির্বাহ মেট্রিক্স এখানে দেখা যাবে।",
      sla_title: "এখনও কোনো নির্ভরযোগ্যতার ডেটা নেই",
      sla_subtitle: "আপটাইম, ব্যর্থতার হার এবং হিলিং মেট্রিক্স দেখতে আপনার এজেন্টগুলি চালান।",
      sla_no_agents: "এই সময়কালে কোনো এজেন্ট নির্বাহ করেনি।",
      analytics_title: "এখনও কোনো বিশ্লেষণ ডেটা নেই",
      analytics_subtitle: "আপনার এজেন্টগুলি নির্বাহ সম্পন্ন করলে চার্ট এবং অন্তর্দৃষ্টি এখানে দেখা যাবে।",
      action_create_persona: "আপনার প্রথম এজেন্ট তৈরি করুন",
      action_run_test: "একটি পরীক্ষা নির্বাহ চালান",
      // Realtime visualizer
      realtime_title: "Watch your events flow in real time",
      realtime_subtitle: "Animated particles trace each event as it travels from sources to your agents. Every dot is a live event moving through your system.",
      realtime_action: "Send a test event",
      // Observability display variants
      alerts_title: "All quiet — no alerts triggered",
      alerts_subtitle: "When monitoring rules detect something worth your attention, alerts will appear here automatically.",
      obs_metrics_title: "No execution data yet",
      obs_metrics_subtitle: "Distribution charts will populate once your agents have completed some executions.",
      // Chart empty states
      cost_chart_title: "No cost data yet",
      cost_chart_subtitle: "Run a persona to see spending trends over time.",
      health_chart_title: "No execution health data yet",
      health_chart_subtitle: "Run a persona to see success and failure rates here.",
      traces_title: "No system traces recorded",
      traces_subtitle: "Traces appear when design, credential, or template operations run.",
      // Healing timeline
      healing_title: "Your system is running smoothly",
      healing_subtitle: "When issues are detected, the full healing timeline appears here — from detection through diagnosis to resolution.",
    },
    errorRecovery: {
      // TODO(i18n-bn): translate from English placeholders
      offline_message: "The real-time event stream is disconnected.",
      offline_cause: "This usually means the backend process stopped or the connection was interrupted.",
      offline_action: "Reconnect",
      event_failed_message: "This event did not complete successfully.",
      event_failed_cause: "The agent encountered an error while processing this event.",
      audit_fetch_failed: "Could not load the healing audit log.",
      audit_fetch_cause: "The log may be temporarily unavailable. Your other data is unaffected.",
      alert_save_failed: "Could not save the alert rule.",
      alert_save_cause: "The change was not applied. Check your connection and try again.",
      alert_toggle_failed: "Could not update the alert rule.",
      alert_toggle_cause: "The rule state may not have changed. Try again in a moment.",
      alert_delete_failed: "Could not delete the alert rule.",
      alert_delete_cause: "The rule is still active. Try again in a moment.",
      alert_eval_failed: "Alert evaluation encountered an error.",
      alert_eval_cause_prefix: "Last failure:",
      alert_eval_total_failures: "total failures",
      alert_invalid_threshold: "Enter a valid number.",
      panel_loaded: "Loaded",
      panel_failed: "Failed to load",
      panel_stale: "Data may be outdated",
      action_retry: "Retry",
      action_check_connection: "Check Connection",
      action_open_settings: "Open Settings",
    },
  },
};
