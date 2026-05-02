// TODO(i18n-zh): translate from English placeholders. Structure must match en.ts exactly.
export const zh = {
  overview: {
    trend: {
      up: "上升",
      down: "下降",
      stable: "稳定 — 无显著变化",
      vs_previous: "与上一周期对比",
    },

    emptyState: {
      metrics_title: "您的代理尚未运行",
      metrics_subtitle: "代理开始处理后，执行指标（如成本、延迟和成功率）将显示在此处。",
      sla_title: "暂无可靠性数据",
      sla_subtitle: "运行您的代理以查看正常运行时间、故障率和修复指标。",
      sla_no_agents: "此期间没有代理执行。",
      analytics_title: "暂无分析数据",
      analytics_subtitle: "代理完成执行后，图表和洞察将显示在此处。",
      action_create_persona: "创建您的第一个代理",
      action_run_test: "运行测试执行",
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
      // TODO(i18n-zh): translate from English placeholders
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
