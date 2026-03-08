// -- Copilot model presets --

export const COPILOT_GITHUB_TOKEN_SETTING = 'copilot_github_token';

export interface CopilotPreset {
  /** Value used in the model selector dropdown */
  value: string;
  /** User-facing label */
  label: string;
  /** Model ID sent to the Copilot CLI via --model flag */
  modelId: string;
}

export const COPILOT_PRESETS: CopilotPreset[] = [
  { value: 'copilot:gpt-5-mini', label: 'GPT 5 mini (free, Copilot)', modelId: 'gpt-5-mini' },
  { value: 'copilot:gemini-3-flash', label: 'Gemini 3 Flash (Copilot)', modelId: 'gemini-3-flash' },
  { value: 'copilot:claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (Copilot)', modelId: 'claude-sonnet-4.6' },
];

/** Check if a dropdown value is a Copilot preset. */
export function isCopilotValue(value: string): boolean {
  return value.startsWith('copilot:');
}

/** Get the preset for a dropdown value, or undefined. */
export function getCopilotPreset(value: string): CopilotPreset | undefined {
  return COPILOT_PRESETS.find((p) => p.value === value);
}
