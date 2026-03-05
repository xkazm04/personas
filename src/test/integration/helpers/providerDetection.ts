/**
 * Detects which CLI providers are installed and authenticated.
 * Results are cached for the lifetime of the test run.
 */
import { execSync } from 'child_process';
import type { ProviderName, ProviderInfo } from './types';

const PROVIDER_CONFIGS: Array<{
  name: ProviderName;
  displayName: string;
  model: string;
  versionCmd: string;
  /** Pattern the version output must match to confirm correct CLI variant */
  versionPattern?: RegExp;
}> = [
  {
    name: 'claude',
    displayName: 'Claude Code',
    model: 'claude-sonnet-4-6',
    versionCmd: 'claude --version',
    versionPattern: /claude/i,
  },
  {
    name: 'gemini',
    displayName: 'Gemini CLI',
    model: 'gemini-3.1-flash-lite-preview',
    versionCmd: 'gemini --version',
  },
  {
    name: 'copilot',
    displayName: 'Copilot CLI (Codex)',
    model: 'gpt-5.1-codex-mini',
    versionCmd: 'copilot --version',
    // Must be OpenAI's Codex CLI, not GitHub Copilot CLI
    versionPattern: /codex|openai/i,
  },
];

let cachedProviders: ProviderInfo[] | null = null;

function checkProvider(config: (typeof PROVIDER_CONFIGS)[0]): ProviderInfo {
  const unavailable: ProviderInfo = {
    name: config.name,
    displayName: config.displayName,
    model: config.model,
    available: false,
  };

  try {
    // Unset CLAUDECODE to avoid nested session detection when checking Claude
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const output = execSync(config.versionCmd, {
      timeout: 10_000,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: true,
      env,
    }).trim();

    const version = output.split('\n')[0].trim();

    // Sanity check: version string should contain at least one digit
    if (!/\d/.test(version)) {
      return unavailable;
    }

    // If a version pattern is specified, verify the CLI is the expected variant
    // (e.g., distinguish OpenAI Codex CLI from GitHub Copilot CLI)
    if (config.versionPattern && !config.versionPattern.test(version)) {
      return unavailable;
    }

    return {
      name: config.name,
      displayName: config.displayName,
      model: config.model,
      available: true,
      version,
    };
  } catch {
    return unavailable;
  }
}

/** Detect all providers. Cached after first call. */
export function detectProviders(): ProviderInfo[] {
  if (cachedProviders) return cachedProviders;
  cachedProviders = PROVIDER_CONFIGS.map(checkProvider);
  return cachedProviders;
}

/** Get a single provider's info. */
export function getProvider(name: ProviderName): ProviderInfo {
  return detectProviders().find((p) => p.name === name)!;
}

/** Get only available providers. */
export function getAvailableProviders(): ProviderInfo[] {
  return detectProviders().filter((p) => p.available);
}

/** Reset cache (for testing the detection itself). */
export function resetProviderCache(): void {
  cachedProviders = null;
}
