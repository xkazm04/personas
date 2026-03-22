/**
 * Detects which CLI providers are installed and authenticated.
 * Supports multi-model configuration per provider, scoped via env vars.
 *
 * Environment variables for scoping:
 *   CLI_TEST_PROVIDERS  — comma-separated provider names (e.g. "claude,copilot")
 *   CLI_TEST_MODELS     — comma-separated model IDs (e.g. "claude-sonnet-4-6,gpt-5.4")
 *   CLI_TEST_TIERS      — comma-separated tiers (e.g. "budget,standard")
 *   CLI_TEST_FEATURES   — comma-separated feature areas (e.g. "persona-design,healing-diagnosis")
 */
import { execSync } from 'child_process';
import type { ProviderName, ProviderInfo, TestMatrixEntry, FeatureArea } from './types';
import { PROVIDER_MODELS } from './types';

const PROVIDER_CONFIGS: Array<{
  name: ProviderName;
  displayName: string;
  defaultModel: string;
  versionCmd: string;
  versionPattern?: RegExp;
}> = [
  {
    name: 'claude',
    displayName: 'Claude Code',
    defaultModel: 'claude-sonnet-4-6',
    versionCmd: 'claude --version',
    versionPattern: /claude/i,
  },
  {
    name: 'gemini',
    displayName: 'Gemini CLI',
    defaultModel: 'gemini-2.5-flash-lite',
    versionCmd: 'gemini --version',
  },
  // copilot provider removed — no longer in scope
];

let cachedProviders: ProviderInfo[] | null = null;

function checkProvider(config: (typeof PROVIDER_CONFIGS)[0]): ProviderInfo {
  const unavailable: ProviderInfo = {
    name: config.name,
    displayName: config.displayName,
    model: config.defaultModel,
    available: false,
  };

  try {
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

    if (!/\d/.test(version)) {
      return unavailable;
    }

    if (config.versionPattern && !config.versionPattern.test(version)) {
      return unavailable;
    }

    return {
      name: config.name,
      displayName: config.displayName,
      model: config.defaultModel,
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

// ═══════════════════════════════════════════════════════════════════════════
// Test matrix builder — env-driven provider/model scoping
// ═══════════════════════════════════════════════════════════════════════════

function parseEnvList(envVar: string): string[] | null {
  const val = process.env[envVar];
  if (!val) return null;
  return val.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Build the test matrix from available providers + env scoping.
 *
 * Without env vars, returns each available provider with its default model.
 * With env vars, filters and expands to all matching provider/model combos.
 */
export function buildTestMatrix(): TestMatrixEntry[] {
  const available = getAvailableProviders();
  const providerFilter = parseEnvList('CLI_TEST_PROVIDERS');
  const modelFilter = parseEnvList('CLI_TEST_MODELS');
  const tierFilter = parseEnvList('CLI_TEST_TIERS');

  const entries: TestMatrixEntry[] = [];

  for (const provider of available) {
    // Skip providers not in scope
    if (providerFilter && !providerFilter.includes(provider.name)) continue;

    const models = PROVIDER_MODELS[provider.name] ?? [];

    // If no model/tier filters, use default model only
    if (!modelFilter && !tierFilter) {
      const defaultSpec = models.find((m) => m.id === provider.model) ?? {
        id: provider.model,
        label: provider.model,
        tier: 'standard' as const,
      };
      entries.push({ provider, model: defaultSpec });
      continue;
    }

    // Otherwise expand to all matching models
    for (const model of models) {
      if (modelFilter && !modelFilter.includes(model.id)) continue;
      if (tierFilter && !tierFilter.includes(model.tier)) continue;
      entries.push({ provider, model });
    }
  }

  return entries;
}

/** Get scoped feature areas from CLI_TEST_FEATURES env var. */
export function getScopedFeatures(): FeatureArea[] | null {
  const list = parseEnvList('CLI_TEST_FEATURES');
  return list as FeatureArea[] | null;
}
