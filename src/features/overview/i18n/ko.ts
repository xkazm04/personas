// TODO(i18n-ko): translate from English placeholders. Structure must match en.ts exactly.
export const ko = {
  overview: {
    trend: {
      up: "상승",
      down: "하락",
      stable: "안정 — 유의미한 변화 없음",
      vs_previous: "이전 기간 대비",
    },

    emptyState: {
      metrics_title: "에이전트가 아직 실행되지 않았습니다",
      metrics_subtitle: "에이전트가 처리를 시작하면 비용, 지연 시간, 성공률 등의 실행 지표가 여기에 표시됩니다.",
      sla_title: "아직 신뢰성 데이터가 없습니다",
      sla_subtitle: "에이전트를 실행하여 가동 시간, 장애율 및 복구 지표를 확인하세요.",
      sla_no_agents: "이 기간에 실행된 에이전트가 없습니다.",
      analytics_title: "아직 분석 데이터가 없습니다",
      analytics_subtitle: "에이전트가 실행을 완료하면 차트와 인사이트가 여기에 표시됩니다.",
      action_create_persona: "첫 번째 에이전트 만들기",
      action_run_test: "테스트 실행하기",
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
      // TODO(i18n-ko): translate from English placeholders
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
