/**
 * English source-of-truth for the Lab feature.
 *
 * Convention: every key here MUST exist in all 13 other locale files in this
 * folder. When you add a key, also add it to the others (use the English value
 * as a placeholder + a `// TODO(i18n-XX)` marker so untranslated strings are
 * grep-able). See `.claude/CLAUDE.md` -> "UI Conventions -> Internationalization".
 *
 * Voice: warm, encouraging, action-oriented. The user should feel guided, not blocked.
 */
export const en = {
  lab: {
    guide: {
      noPrompt: {
        message: "Almost ready! Your persona needs a prompt before testing.",
        action: "Add one now",
      },
      noTools: {
        message: "Tip: Add tools to your persona for richer, more realistic testing.",
      },
      selectModels: {
        message: "Pick at least one model above to run your test.",
      },
      selectVersionA: {
        message: "Choose Version A above to start comparing.",
      },
      selectVersionB: {
        message: "Almost there! Now pick Version B to compare against.",
      },
      needMoreVersions: {
        message: "You need at least 2 prompt versions to evaluate. Let's create more!",
        action: "Go to Versions",
      },
      selectVersions: {
        message: "Select at least 2 prompt versions above to begin evaluation.",
      },
      describeChanges: {
        message: "Tell the AI what you'd like to improve. Describe your desired changes above.",
      },
    },
    tabs: {
      arena: { label: "Arena", desc: "Compare models side by side" },
      improve: { label: "Improve", desc: "AI-driven prompt improvement" },
      mixMatch: { label: "Mix & Match", desc: "Combine strengths from your best agents" },
      autoImprove: { label: "Auto-Improve", desc: "Automatically refine over multiple rounds" },
      versions: { label: "Versions", desc: "Track how your agent changed over time" },
    },
    purpose: {
      arena: "Pit different models against each other on the same task to find which performs best.",
      improve: "Describe what you want to change and let the AI generate and test a new draft.",
      ab: "Compare two prompt versions head-to-head to see which one performs better.",
      eval: "Test multiple prompt versions across models to see which one scores highest.",
      mixMatch: "Combine the best qualities from multiple agents into a new one.",
      autoImprove: "Set it and forget it — your agent will automatically try new approaches and keep what works.",
    },
    evolution: {
      title: "Auto-Improve",
      subtitle: "Automatically refine your agent over multiple rounds",
      toggle: "Continuous Improvement",
      rounds: "Rounds",
      improvements: "Improvements",
      nextRound: "Next Round",
      triggerRound: "Start Improvement Round",
      improving: "Improving...",
      creativityLevel: "Creativity Level",
      creativityTooltip: "Higher values mean bigger changes between rounds. Lower values make smaller, safer tweaks.",
      variationsPerRound: "Variations per Round",
      minimumImprovement: "Minimum Improvement",
      runsBetweenRounds: "Runs Between Rounds",
      saveSettings: "Save Settings",
      historyTitle: "Improvement History",
      variationsTested: "variations tested",
      applied: "Applied",
      current: "Current",
      best: "Best",
      emptyTitle: "Self-improving agents",
      emptyDesc: "Turn on continuous improvement and your agent will automatically try new approaches, test them, and keep what works best.",
      selectPersona: "Select an agent to configure auto-improvement",
      statusUnreliable: "Status tracking was interrupted — progress shown may have been delayed",
    },
    mixMatch: {
      title: "Mix & Match",
      subtitle: "Combine strengths from your best agents into a new one",
      selectParents: "Pick Agents to Combine (2-5)",
      priorityBalance: "Priority Balance",
      creativityLevel: "Creativity Level",
      rounds: "Rounds",
      startCombining: "Start Combining",
      combining: "Combining...",
      historyTitle: "Combination History",
      progressTitle: "Progress",
      progressSubtitle: "Performance trend across rounds",
      resultsSubtitle: "Save top performers as new agents",
      showChanges: "Show what changed",
      hideChanges: "Hide changes",
      compareWithSource: "Compare with source",
      saved: "Saved",
      saveAsAgent: "Save as Agent",
      deleteRun: "Delete run",
      inProgress: "Combining in progress...",
      resultsWillAppear: "Results will appear when the run completes",
      emptyTitle: "Improve your agents",
      emptyDesc: "Pick 2-5 agents above, set your priorities, then click Start Combining. The system will mix their best qualities and create new variations for you to try.",
      sources: "sources",
      results: "results",
      noPersonas: "No agents available",
    },
    diff: {
      title: "What Changed",
      changes: "changes",
      instructions: "Instructions",
      tools: "Tools",
      model: "Model",
      settings: "Settings",
    },
    chart: {
      progressTitle: "Progress",
      best: "Best",
      avg: "Avg",
      worst: "Worst",
      scoreChange: "score change",
      noBaseline: "No baseline data",
      totalResults: "total results",
    },
    export: {
      downloadHtml: "Export HTML",
      copyMarkdown: "Copy Markdown",
      copied: "Copied!",
    },
    radar: {
      title: "Model Performance Radar",
      toolAccuracy: "Tool Accuracy",
      outputQuality: "Output Quality",
      protocolCompliance: "Protocol Compliance",
      score: "Score",
    },
    shared: {
      quality: "Quality",
      speed: "Speed",
      cost: "Cost",
      overall: "Overall",
    },
    evalMethod: {
      timeoutTitle: "Scores estimated (evaluation timed out)",
      timeoutDesc: "The AI evaluator did not respond in time. These scores use keyword-matching heuristics and may differ significantly from full evaluation. Re-run for accurate results.",
      fallbackTitle: "Scores estimated (evaluation unavailable)",
      fallbackDesc: "The AI evaluator was unreachable. These scores use keyword-matching heuristics and may differ significantly from full evaluation. Re-run for accurate results.",
    },
  },
};
