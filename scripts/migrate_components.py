"""
Migration script: moves persona components to feature-module structure,
updates relative imports to @/ absolute paths, and fixes hardcoded color tokens.
"""
import os
import re

BASE = "C:/Users/mkdol/dolla/personas/src/features/personas/components"
SRC = "C:/Users/mkdol/dolla/personas/src"

# ─── File move mapping: old relative path → new absolute path ─────────────
FILE_MAP = {
    # shared
    "Sidebar.tsx":                    f"{SRC}/features/shared/components/Sidebar.tsx",
    "ThemeSelector.tsx":              f"{SRC}/features/shared/components/ThemeSelector.tsx",
    "AuthButton.tsx":                 f"{SRC}/features/shared/components/AuthButton.tsx",
    "MarkdownRenderer.tsx":           f"{SRC}/features/shared/components/MarkdownRenderer.tsx",
    "EmptyState.tsx":                 f"{SRC}/features/shared/components/EmptyState.tsx",
    "UpdateBanner.tsx":               f"{SRC}/features/shared/components/UpdateBanner.tsx",
    "TerminalHeader.tsx":             f"{SRC}/features/shared/components/TerminalHeader.tsx",
    # overview
    "OverviewPage.tsx":               f"{SRC}/features/overview/components/OverviewPage.tsx",
    "GlobalExecutionList.tsx":        f"{SRC}/features/overview/sub_executions/GlobalExecutionList.tsx",
    "ManualReviewList.tsx":           f"{SRC}/features/overview/sub_manual-review/ManualReviewList.tsx",
    "ReviewExpandedDetail.tsx":       f"{SRC}/features/overview/sub_manual-review/ReviewExpandedDetail.tsx",
    "MessageList.tsx":                f"{SRC}/features/overview/sub_messages/MessageList.tsx",
    "EventLogList.tsx":               f"{SRC}/features/overview/sub_events/EventLogList.tsx",
    "UsageDashboard.tsx":             f"{SRC}/features/overview/sub_usage/UsageDashboard.tsx",
    "DashboardFilters.tsx":           f"{SRC}/features/overview/sub_usage/DashboardFilters.tsx",
    "charts/ChartTooltip.tsx":        f"{SRC}/features/overview/sub_usage/charts/ChartTooltip.tsx",
    "charts/chartConstants.ts":       f"{SRC}/features/overview/sub_usage/charts/chartConstants.ts",
    "ObservabilityDashboard.tsx":     f"{SRC}/features/overview/sub_observability/ObservabilityDashboard.tsx",
    "HealingIssueModal.tsx":          f"{SRC}/features/overview/sub_observability/HealingIssueModal.tsx",
    "RealtimeVisualizerPage.tsx":     f"{SRC}/features/overview/sub_realtime/RealtimeVisualizerPage.tsx",
    "realtime/RealtimeStatsBar.tsx":  f"{SRC}/features/overview/sub_realtime/RealtimeStatsBar.tsx",
    "realtime/EventBusVisualization.tsx": f"{SRC}/features/overview/sub_realtime/EventBusVisualization.tsx",
    "realtime/EventDetailDrawer.tsx": f"{SRC}/features/overview/sub_realtime/EventDetailDrawer.tsx",
    "realtime/BusLane.tsx":           f"{SRC}/features/overview/sub_realtime/BusLane.tsx",
    "realtime/EventParticle.tsx":     f"{SRC}/features/overview/sub_realtime/EventParticle.tsx",
    "realtime/index.ts":              f"{SRC}/features/overview/sub_realtime/index.ts",
    "MemoriesPage.tsx":               f"{SRC}/features/overview/sub_memories/MemoriesPage.tsx",
    "BudgetSettingsPage.tsx":         f"{SRC}/features/overview/sub_budget/BudgetSettingsPage.tsx",
    # agents
    "PersonaOverviewPage.tsx":        f"{SRC}/features/agents/components/PersonaOverviewPage.tsx",
    "PersonaCard.tsx":                f"{SRC}/features/agents/components/PersonaCard.tsx",
    "CreatePersonaModal.tsx":         f"{SRC}/features/agents/components/CreatePersonaModal.tsx",
    "GroupedAgentSidebar.tsx":        f"{SRC}/features/agents/components/GroupedAgentSidebar.tsx",
    "OnboardingWizard.tsx":           f"{SRC}/features/agents/components/OnboardingWizard.tsx",
    "PersonaEditor.tsx":              f"{SRC}/features/agents/sub_editor/PersonaEditor.tsx",
    "PersonaPromptEditor.tsx":        f"{SRC}/features/agents/sub_editor/PersonaPromptEditor.tsx",
    "PromptSectionTab.tsx":           f"{SRC}/features/agents/sub_editor/PromptSectionTab.tsx",
    "PromptVersionHistory.tsx":       f"{SRC}/features/agents/sub_editor/PromptVersionHistory.tsx",
    "PhaseIndicator.tsx":             f"{SRC}/features/agents/sub_editor/PhaseIndicator.tsx",
    "ToolSelector.tsx":               f"{SRC}/features/agents/sub_editor/ToolSelector.tsx",
    "NotificationChannelSettings.tsx":f"{SRC}/features/agents/sub_editor/NotificationChannelSettings.tsx",
    "DesignTab.tsx":                  f"{SRC}/features/agents/sub_editor/DesignTab.tsx",
    "ExecutionList.tsx":              f"{SRC}/features/agents/sub_executions/ExecutionList.tsx",
    "ExecutionDetail.tsx":            f"{SRC}/features/agents/sub_executions/ExecutionDetail.tsx",
    "ExecutionInspector.tsx":         f"{SRC}/features/agents/sub_executions/ExecutionInspector.tsx",
    "ExecutionTerminal.tsx":          f"{SRC}/features/agents/sub_executions/ExecutionTerminal.tsx",
    "PersonaRunner.tsx":              f"{SRC}/features/agents/sub_executions/PersonaRunner.tsx",
    # vault
    "CredentialManager.tsx":          f"{SRC}/features/vault/components/CredentialManager.tsx",
    "CredentialList.tsx":             f"{SRC}/features/vault/components/CredentialList.tsx",
    "CredentialCard.tsx":             f"{SRC}/features/vault/components/CredentialCard.tsx",
    "CredentialEditForm.tsx":         f"{SRC}/features/vault/components/CredentialEditForm.tsx",
    "CredentialPicker.tsx":           f"{SRC}/features/vault/components/CredentialPicker.tsx",
    "CredentialDesignModal.tsx":      f"{SRC}/features/vault/components/CredentialDesignModal.tsx",
    "CredentialEventConfig.tsx":      f"{SRC}/features/vault/components/CredentialEventConfig.tsx",
    "ConnectorCredentialModal.tsx":   f"{SRC}/features/vault/components/ConnectorCredentialModal.tsx",
    "VaultStatusBadge.tsx":           f"{SRC}/features/vault/components/VaultStatusBadge.tsx",
    # triggers
    "TriggerList.tsx":                f"{SRC}/features/triggers/components/TriggerList.tsx",
    "TriggerConfig.tsx":              f"{SRC}/features/triggers/components/TriggerConfig.tsx",
    "ActivityDiagramModal.tsx":       f"{SRC}/features/triggers/components/ActivityDiagramModal.tsx",
    # templates
    "DesignReviewsPage.tsx":          f"{SRC}/features/templates/components/DesignReviewsPage.tsx",
    "BuiltinTemplatesTab.tsx":        f"{SRC}/features/templates/sub_builtin/BuiltinTemplatesTab.tsx",
    "TemplateConnectorGrid.tsx":      f"{SRC}/features/templates/sub_builtin/TemplateConnectorGrid.tsx",
    "TemplatePromptPreview.tsx":      f"{SRC}/features/templates/sub_builtin/TemplatePromptPreview.tsx",
    "TemplateQualitySection.tsx":     f"{SRC}/features/templates/sub_builtin/TemplateQualitySection.tsx",
    "N8nImportTab.tsx":               f"{SRC}/features/templates/sub_n8n/N8nImportTab.tsx",
    "GeneratedReviewsTab.tsx":        f"{SRC}/features/templates/sub_generated/GeneratedReviewsTab.tsx",
    "DesignReviewRunner.tsx":         f"{SRC}/features/templates/sub_generated/DesignReviewRunner.tsx",
    "DesignTerminal.tsx":             f"{SRC}/features/templates/sub_generated/DesignTerminal.tsx",
    "DesignTestResults.tsx":          f"{SRC}/features/templates/sub_generated/DesignTestResults.tsx",
    "DesignResultPreview.tsx":        f"{SRC}/features/templates/sub_generated/DesignResultPreview.tsx",
    "DesignInput.tsx":                f"{SRC}/features/templates/sub_generated/DesignInput.tsx",
    "DesignCheckbox.tsx":             f"{SRC}/features/templates/sub_generated/DesignCheckbox.tsx",
    "DesignChatInput.tsx":            f"{SRC}/features/templates/sub_generated/DesignChatInput.tsx",
    "DesignHighlightsGrid.tsx":       f"{SRC}/features/templates/sub_generated/DesignHighlightsGrid.tsx",
    # pipeline
    "TeamCanvas.tsx":                 f"{SRC}/features/pipeline/components/TeamCanvas.tsx",
    "team/TeamList.tsx":              f"{SRC}/features/pipeline/components/TeamList.tsx",
    "team/TeamConfigPanel.tsx":       f"{SRC}/features/pipeline/components/TeamConfigPanel.tsx",
    "team/PersonaNode.tsx":           f"{SRC}/features/pipeline/sub_canvas/PersonaNode.tsx",
    "team/ConnectionEdge.tsx":        f"{SRC}/features/pipeline/sub_canvas/ConnectionEdge.tsx",
    "team/TeamToolbar.tsx":           f"{SRC}/features/pipeline/sub_canvas/TeamToolbar.tsx",
    "team/NodeContextMenu.tsx":       f"{SRC}/features/pipeline/sub_canvas/NodeContextMenu.tsx",
    "team/PipelineControls.tsx":      f"{SRC}/features/pipeline/sub_canvas/PipelineControls.tsx",
    "team/teamConstants.tsx":         f"{SRC}/features/pipeline/sub_canvas/teamConstants.tsx",
    # deployment
    "CloudDeployPanel.tsx":           f"{SRC}/features/deployment/components/CloudDeployPanel.tsx",
}

# ─── Import path replacement map ─────────────────────────────────────────────
# Ordered: more specific (subfolder) paths first
IMPORT_MAP = [
    # realtime subfolder
    ("./realtime/RealtimeStatsBar",      "@/features/overview/sub_realtime/RealtimeStatsBar"),
    ("./realtime/EventBusVisualization", "@/features/overview/sub_realtime/EventBusVisualization"),
    ("./realtime/EventDetailDrawer",     "@/features/overview/sub_realtime/EventDetailDrawer"),
    ("./realtime/BusLane",               "@/features/overview/sub_realtime/BusLane"),
    ("./realtime/EventParticle",         "@/features/overview/sub_realtime/EventParticle"),
    ("./realtime",                       "@/features/overview/sub_realtime"),
    # charts subfolder
    ("./charts/ChartTooltip",            "@/features/overview/sub_usage/charts/ChartTooltip"),
    ("./charts/chartConstants",          "@/features/overview/sub_usage/charts/chartConstants"),
    # team subfolder
    ("./team/TeamList",                  "@/features/pipeline/components/TeamList"),
    ("./team/TeamConfigPanel",           "@/features/pipeline/components/TeamConfigPanel"),
    ("./team/PersonaNode",               "@/features/pipeline/sub_canvas/PersonaNode"),
    ("./team/ConnectionEdge",            "@/features/pipeline/sub_canvas/ConnectionEdge"),
    ("./team/TeamToolbar",               "@/features/pipeline/sub_canvas/TeamToolbar"),
    ("./team/NodeContextMenu",           "@/features/pipeline/sub_canvas/NodeContextMenu"),
    ("./team/PipelineControls",          "@/features/pipeline/sub_canvas/PipelineControls"),
    ("./team/teamConstants",             "@/features/pipeline/sub_canvas/teamConstants"),
    # shared
    ("./Sidebar",                        "@/features/shared/components/Sidebar"),
    ("./ThemeSelector",                  "@/features/shared/components/ThemeSelector"),
    ("./AuthButton",                     "@/features/shared/components/AuthButton"),
    ("./MarkdownRenderer",               "@/features/shared/components/MarkdownRenderer"),
    ("./EmptyState",                     "@/features/shared/components/EmptyState"),
    ("./UpdateBanner",                   "@/features/shared/components/UpdateBanner"),
    ("./TerminalHeader",                 "@/features/shared/components/TerminalHeader"),
    # overview
    ("./OverviewPage",                   "@/features/overview/components/OverviewPage"),
    ("./GlobalExecutionList",            "@/features/overview/sub_executions/GlobalExecutionList"),
    ("./ManualReviewList",               "@/features/overview/sub_manual-review/ManualReviewList"),
    ("./ReviewExpandedDetail",           "@/features/overview/sub_manual-review/ReviewExpandedDetail"),
    ("./MessageList",                    "@/features/overview/sub_messages/MessageList"),
    ("./EventLogList",                   "@/features/overview/sub_events/EventLogList"),
    ("./UsageDashboard",                 "@/features/overview/sub_usage/UsageDashboard"),
    ("./DashboardFilters",               "@/features/overview/sub_usage/DashboardFilters"),
    ("./ObservabilityDashboard",         "@/features/overview/sub_observability/ObservabilityDashboard"),
    ("./HealingIssueModal",              "@/features/overview/sub_observability/HealingIssueModal"),
    ("./RealtimeVisualizerPage",         "@/features/overview/sub_realtime/RealtimeVisualizerPage"),
    ("./MemoriesPage",                   "@/features/overview/sub_memories/MemoriesPage"),
    ("./BudgetSettingsPage",             "@/features/overview/sub_budget/BudgetSettingsPage"),
    # agents
    ("./PersonaOverviewPage",            "@/features/agents/components/PersonaOverviewPage"),
    ("./PersonaCard",                    "@/features/agents/components/PersonaCard"),
    ("./CreatePersonaModal",             "@/features/agents/components/CreatePersonaModal"),
    ("./GroupedAgentSidebar",            "@/features/agents/components/GroupedAgentSidebar"),
    ("./OnboardingWizard",               "@/features/agents/components/OnboardingWizard"),
    ("./PersonaEditor",                  "@/features/agents/sub_editor/PersonaEditor"),
    ("./PersonaPromptEditor",            "@/features/agents/sub_editor/PersonaPromptEditor"),
    ("./PromptSectionTab",               "@/features/agents/sub_editor/PromptSectionTab"),
    ("./PromptVersionHistory",           "@/features/agents/sub_editor/PromptVersionHistory"),
    ("./PhaseIndicator",                 "@/features/agents/sub_editor/PhaseIndicator"),
    ("./ToolSelector",                   "@/features/agents/sub_editor/ToolSelector"),
    ("./NotificationChannelSettings",    "@/features/agents/sub_editor/NotificationChannelSettings"),
    ("./DesignTab",                      "@/features/agents/sub_editor/DesignTab"),
    ("./ExecutionList",                  "@/features/agents/sub_executions/ExecutionList"),
    ("./ExecutionDetail",                "@/features/agents/sub_executions/ExecutionDetail"),
    ("./ExecutionInspector",             "@/features/agents/sub_executions/ExecutionInspector"),
    ("./ExecutionTerminal",              "@/features/agents/sub_executions/ExecutionTerminal"),
    ("./PersonaRunner",                  "@/features/agents/sub_executions/PersonaRunner"),
    # vault
    ("./CredentialManager",              "@/features/vault/components/CredentialManager"),
    ("./CredentialList",                 "@/features/vault/components/CredentialList"),
    ("./CredentialCard",                 "@/features/vault/components/CredentialCard"),
    ("./CredentialEditForm",             "@/features/vault/components/CredentialEditForm"),
    ("./CredentialPicker",               "@/features/vault/components/CredentialPicker"),
    ("./CredentialDesignModal",          "@/features/vault/components/CredentialDesignModal"),
    ("./CredentialEventConfig",          "@/features/vault/components/CredentialEventConfig"),
    ("./ConnectorCredentialModal",       "@/features/vault/components/ConnectorCredentialModal"),
    ("./VaultStatusBadge",               "@/features/vault/components/VaultStatusBadge"),
    # triggers
    ("./TriggerList",                    "@/features/triggers/components/TriggerList"),
    ("./TriggerConfig",                  "@/features/triggers/components/TriggerConfig"),
    ("./ActivityDiagramModal",           "@/features/triggers/components/ActivityDiagramModal"),
    # templates
    ("./DesignReviewsPage",              "@/features/templates/components/DesignReviewsPage"),
    ("./BuiltinTemplatesTab",            "@/features/templates/sub_builtin/BuiltinTemplatesTab"),
    ("./TemplateConnectorGrid",          "@/features/templates/sub_builtin/TemplateConnectorGrid"),
    ("./TemplatePromptPreview",          "@/features/templates/sub_builtin/TemplatePromptPreview"),
    ("./TemplateQualitySection",         "@/features/templates/sub_builtin/TemplateQualitySection"),
    ("./N8nImportTab",                   "@/features/templates/sub_n8n/N8nImportTab"),
    ("./GeneratedReviewsTab",            "@/features/templates/sub_generated/GeneratedReviewsTab"),
    ("./DesignReviewRunner",             "@/features/templates/sub_generated/DesignReviewRunner"),
    ("./DesignTerminal",                 "@/features/templates/sub_generated/DesignTerminal"),
    ("./DesignTestResults",              "@/features/templates/sub_generated/DesignTestResults"),
    ("./DesignResultPreview",            "@/features/templates/sub_generated/DesignResultPreview"),
    ("./DesignInput",                    "@/features/templates/sub_generated/DesignInput"),
    ("./DesignCheckbox",                 "@/features/templates/sub_generated/DesignCheckbox"),
    ("./DesignChatInput",                "@/features/templates/sub_generated/DesignChatInput"),
    ("./DesignHighlightsGrid",           "@/features/templates/sub_generated/DesignHighlightsGrid"),
    # pipeline
    ("./TeamCanvas",                     "@/features/pipeline/components/TeamCanvas"),
    # deployment
    ("./CloudDeployPanel",               "@/features/deployment/components/CloudDeployPanel"),
]

# ─── Color token substitutions ───────────────────────────────────────────────
COLOR_SUBS = [
    # white text with opacity → foreground with opacity
    (r'\btext-white/(\d+)\b', r'text-foreground/\1'),
    # white text (plain) → foreground
    (r'\btext-white\b', 'text-foreground'),
    # gray/slate/zinc backgrounds with opacity → background with opacity
    (r'\bbg-zinc-900/(\d+)\b', r'bg-background/\1'),
    (r'\bbg-gray-950/(\d+)\b', r'bg-background/\1'),
    (r'\bbg-gray-900/(\d+)\b', r'bg-background/\1'),
    (r'\bbg-slate-900/(\d+)\b', r'bg-background/\1'),
    # same without opacity
    (r'\bbg-zinc-900\b', 'bg-background'),
    (r'\bbg-gray-950\b', 'bg-background'),
    (r'\bbg-gray-900\b', 'bg-background'),
    (r'\bbg-slate-900\b', 'bg-background'),
    (r'\bbg-zinc-800\b', 'bg-secondary'),
    (r'\bbg-gray-800\b', 'bg-secondary'),
    (r'\bbg-slate-800\b', 'bg-secondary'),
    # gray muted text
    (r'\btext-gray-400\b', 'text-muted-foreground'),
    (r'\btext-gray-500\b', 'text-muted-foreground'),
    (r'\btext-slate-400\b', 'text-muted-foreground'),
    (r'\btext-slate-500\b', 'text-muted-foreground'),
    (r'\btext-zinc-400\b', 'text-muted-foreground'),
    (r'\btext-zinc-500\b', 'text-muted-foreground'),
    # borders
    (r'\bborder-gray-700\b', 'border-border'),
    (r'\bborder-gray-800\b', 'border-border'),
    (r'\bborder-slate-700\b', 'border-border'),
    (r'\bborder-zinc-700\b', 'border-border'),
    (r'\bborder-zinc-800\b', 'border-border'),
    # white/opacity borders → foreground/opacity
    (r'\bborder-white/(\d+)\b', r'border-foreground/\1'),
]


def apply_import_subs(content):
    for old, new in IMPORT_MAP:
        content = content.replace(f"'{old}'", f"'{new}'")
        content = content.replace(f'"{old}"', f'"{new}"')
    return content


def apply_color_subs(content):
    for pattern, replacement in COLOR_SUBS:
        content = re.sub(pattern, replacement, content)
    return content


def apply_special_cases(content, rel_key):
    # TeamConfigPanel moves to pipeline/components/ but teamConstants goes to
    # pipeline/sub_canvas/ - the ./teamConstants sibling import breaks
    if rel_key == "team/TeamConfigPanel.tsx":
        content = content.replace("'./teamConstants'",
                                  "'@/features/pipeline/sub_canvas/teamConstants'")
        content = content.replace('"./teamConstants"',
                                  '"@/features/pipeline/sub_canvas/teamConstants"')
    return content


moved = 0
failed = []

for rel_key, dest_path in FILE_MAP.items():
    src_path = os.path.join(BASE, rel_key)
    if not os.path.exists(src_path):
        failed.append(f"MISSING: {src_path}")
        continue
    try:
        with open(src_path, "r", encoding="utf-8") as f:
            content = f.read()
        content = apply_import_subs(content)
        content = apply_special_cases(content, rel_key)
        content = apply_color_subs(content)
        os.makedirs(os.path.dirname(dest_path), exist_ok=True)
        with open(dest_path, "w", encoding="utf-8") as f:
            f.write(content)
        moved += 1
    except Exception as e:
        failed.append(f"ERROR {rel_key}: {e}")

print(f"Moved: {moved}/{len(FILE_MAP)}")
if failed:
    print("Failures:")
    for item in failed:
        print(f"  {item}")
else:
    print("All files processed successfully!")
