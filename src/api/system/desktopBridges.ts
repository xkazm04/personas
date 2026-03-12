import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

// -- Bridge action types ----------------------------------------------

export interface BridgeActionResult {
  success: boolean;
  output: string;
  error: string | null;
  duration_ms: number;
  bridge: string;
  action: string;
}

// VS Code actions
export type VsCodeAction =
  | { action: "OpenFile"; params: { path: string; line?: number } }
  | { action: "OpenFolder"; params: { path: string } }
  | { action: "DiffFiles"; params: { left: string; right: string } }
  | { action: "ListExtensions" }
  | { action: "InstallExtension"; params: { extension_id: string } }
  | { action: "RunTask"; params: { task_name: string; folder?: string } }
  | { action: "Version" };

// Docker actions
export type DockerAction =
  | { action: "ListContainers"; params: { all: boolean } }
  | { action: "ListImages" }
  | { action: "StartContainer"; params: { container: string } }
  | { action: "StopContainer"; params: { container: string } }
  | { action: "RestartContainer"; params: { container: string } }
  | { action: "ContainerLogs"; params: { container: string; tail?: number } }
  | { action: "InspectContainer"; params: { container: string } }
  | { action: "Exec"; params: { container: string; command: string[] } }
  | { action: "ComposeUp"; params: { file?: string; detach: boolean } }
  | { action: "ComposeDown"; params: { file?: string } }
  | { action: "ComposePs"; params: { file?: string } }
  | { action: "SystemInfo" }
  | { action: "Version" };

// Terminal actions
export type TerminalAction =
  | { action: "Execute"; params: { command: string[]; working_dir?: string } }
  | { action: "ReadFile"; params: { path: string } }
  | { action: "WriteFile"; params: { path: string; content: string } }
  | { action: "ListDir"; params: { path: string } }
  | { action: "PathExists"; params: { path: string } };

// Obsidian actions
export type ObsidianAction =
  | { action: "ListNotes"; params: { folder?: string } }
  | { action: "ReadNote"; params: { path: string } }
  | { action: "WriteNote"; params: { path: string; content: string } }
  | { action: "SearchNotes"; params: { query: string; max_results?: number } }
  | { action: "VaultStructure" }
  | { action: "AppendToNote"; params: { path: string; content: string } };

export type BridgeAction =
  | VsCodeAction
  | DockerAction
  | TerminalAction
  | ObsidianAction;

// -- Bridge config ----------------------------------------------------

export interface BridgeConfig {
  vscode_binary?: string;
  docker_binary?: string;
  terminal_shell?: string;
  obsidian_vault_path?: string;
  obsidian_api_port?: number;
  obsidian_api_key?: string;
  env_vars?: Record<string, string>;
}

// -- Plan types -------------------------------------------------------

export interface DesktopStep {
  id: string;
  bridge: string;
  action: BridgeAction;
  depends_on?: string;
  description: string;
}

export interface DesktopPlan {
  id: string;
  name: string;
  steps: DesktopStep[];
  created_at: string;
}

export interface StepResult {
  step_id: string;
  bridge_result: BridgeActionResult;
  injected_context?: string;
}

export interface PlanExecutionResult {
  plan_id: string;
  success: boolean;
  step_results: StepResult[];
  total_duration_ms: number;
  failed_step?: string;
}

export interface RuntimeStatus {
  active_plan: string | null;
  completed_steps: number;
  total_steps: number;
  current_step: string | null;
}

// -- Bridge metadata --------------------------------------------------

export type BridgeName = "vscode" | "docker" | "terminal" | "obsidian";

export const BRIDGE_INFO: Record<
  BridgeName,
  { label: string; description: string; connector: string }
> = {
  vscode: {
    label: "VS Code",
    description: "Open files, manage extensions, run tasks",
    connector: "desktop_vscode",
  },
  docker: {
    label: "Docker",
    description: "Manage containers, images, and compose stacks",
    connector: "desktop_docker",
  },
  terminal: {
    label: "Terminal",
    description: "Execute commands, read/write files",
    connector: "desktop_terminal",
  },
  obsidian: {
    label: "Obsidian",
    description: "Read, write, and search notes in your vault",
    connector: "desktop_obsidian",
  },
};

// -- API calls --------------------------------------------------------

/** Execute a single bridge action. */
export const executeDesktopBridge = (
  bridge: BridgeName,
  action: BridgeAction,
  config?: BridgeConfig,
) =>
  invoke<BridgeActionResult>("execute_desktop_bridge", {
    bridge,
    action,
    config: config ?? null,
  });

/** Execute a multi-step desktop plan. */
export const executeDesktopPlan = (
  plan: DesktopPlan,
  config?: BridgeConfig,
) =>
  invoke<PlanExecutionResult>("execute_desktop_plan", {
    plan,
    config: config ?? null,
  });

/** Get the current runtime execution status. */
export const getDesktopRuntimeStatus = () =>
  invoke<RuntimeStatus>("get_desktop_runtime_status", {});

/** Get the cached result of a previously executed plan. */
export const getDesktopPlanResult = (planId: string) =>
  invoke<PlanExecutionResult | null>("get_desktop_plan_result", { planId });
