/**
 * Core CLI runner — spawns real CLI processes, parses streaming JSON output,
 * enforces timeouts, and returns structured results.
 *
 * Mirrors the Rust engine's runner.rs but in TypeScript for the test harness.
 */
import { spawn } from 'child_process';
import * as readline from 'readline';
import type { ProviderName, CliRunnerConfig, StreamEvent, CliRunResult } from './types';

// ═══════════════════════════════════════════════════════════════════════════
// Provider CLI specifications (mirrors src-tauri/src/engine/provider/)
// ═══════════════════════════════════════════════════════════════════════════

interface ProviderSpec {
  command: string;
  baseArgs: string[];
  promptDelivery: 'stdin' | 'flag';
  promptFlag: string;
  outputFormatArgs: string[];
  autoApproveArgs: string[];
  modelFlag: string;
}

const IS_WIN = process.platform === 'win32';

const PROVIDERS: Record<ProviderName, ProviderSpec> = {
  claude: {
    command: 'claude',
    baseArgs: [],
    promptDelivery: 'stdin',
    promptFlag: '-p',
    outputFormatArgs: ['--output-format', 'stream-json', '--verbose'],
    autoApproveArgs: ['--dangerously-skip-permissions'],
    modelFlag: '--model',
  },
  gemini: {
    command: 'gemini',
    baseArgs: [],
    promptDelivery: 'stdin',
    promptFlag: '-p',
    outputFormatArgs: ['--output-format', 'stream-json'],
    autoApproveArgs: ['--yolo'],
    modelFlag: '-m',
  },
  copilot: {
    command: 'copilot',
    baseArgs: [],
    promptDelivery: 'stdin',
    promptFlag: '-p',
    outputFormatArgs: ['--output-format', 'stream-json'],
    autoApproveArgs: ['--sandbox'],
    modelFlag: '--model',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// Stream line parser (handles Claude + Codex/Copilot JSON formats)
// ═══════════════════════════════════════════════════════════════════════════

function parseStreamLine(provider: ProviderName, line: string): StreamEvent {
  const trimmed = line.trim();
  const timestamp = Date.now();
  const base: StreamEvent = { type: 'unknown', raw: line, timestamp };

  if (!trimmed) return base;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let json: any;
  try {
    json = JSON.parse(trimmed);
  } catch {
    // Not JSON — treat as plain text output
    if (trimmed.length > 0) {
      return { ...base, type: 'assistant_text', text: trimmed };
    }
    return base;
  }

  const eventType: string = json.type ?? '';

  switch (eventType) {
    // ── Claude-style events ──────────────────────────────────────────────
    case 'system': {
      if (json.subtype === 'init') {
        return {
          ...base,
          type: 'system_init',
          model: json.model ?? 'unknown',
          sessionId: json.session_id,
        };
      }
      return base;
    }

    case 'assistant': {
      const blocks = json.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          return { ...base, type: 'assistant_text', text: block.text };
        }
        if (block.type === 'tool_use') {
          return {
            ...base,
            type: 'tool_use',
            toolName: block.name,
            toolInput: typeof block.input === 'string' ? block.input : JSON.stringify(block.input),
          };
        }
      }
      return base;
    }

    case 'user': {
      const blocks = json.message?.content ?? [];
      for (const block of blocks) {
        if (block.type === 'tool_result') {
          const preview =
            typeof block.content === 'string' ? block.content : JSON.stringify(block.content);
          return { ...base, type: 'tool_result', toolOutput: preview?.slice(0, 2000) };
        }
      }
      return base;
    }

    // ── Gemini CLI events ────────────────────────────────────────────────
    case 'init': {
      return {
        ...base,
        type: 'system_init',
        model: json.model ?? 'unknown',
        sessionId: json.session_id,
      };
    }

    case 'message': {
      // Gemini: {"type":"message","role":"assistant","content":"...","delta":true}
      if (json.role === 'assistant' && json.content) {
        return { ...base, type: 'assistant_text', text: json.content };
      }
      return base;
    }

    case 'tool_use': {
      // Gemini: {"type":"tool_use","tool_name":"read_file","parameters":{...}}
      return {
        ...base,
        type: 'tool_use',
        toolName: json.tool_name,
        toolInput: typeof json.parameters === 'string' ? json.parameters : JSON.stringify(json.parameters),
      };
    }

    case 'tool_result': {
      // Gemini: {"type":"tool_result","status":"success","output":"..."}
      const output = typeof json.output === 'string' ? json.output : JSON.stringify(json.output);
      return { ...base, type: 'tool_result', toolOutput: output?.slice(0, 2000) };
    }

    // ── Shared: final result ─────────────────────────────────────────────
    case 'result': {
      // Claude: duration_ms, total_cost_usd, total_input_tokens, total_output_tokens
      // Gemini: stats.duration_ms, stats.total_tokens, stats.input_tokens, stats.output_tokens
      const stats = json.stats;
      return {
        ...base,
        type: 'result',
        durationMs: json.duration_ms ?? stats?.duration_ms,
        costUsd: json.total_cost_usd ?? json.cost_usd,
        inputTokens: json.total_input_tokens ?? json.input_tokens ?? stats?.input_tokens,
        outputTokens: json.total_output_tokens ?? json.output_tokens ?? stats?.output_tokens,
        model: json.model,
        sessionId: json.session_id,
      };
    }

    // ── Codex/Copilot-style events ───────────────────────────────────────
    case 'thread.started': {
      return {
        ...base,
        type: 'system_init',
        model: json.model ?? 'unknown',
        sessionId: json.thread_id ?? json.session_id,
      };
    }

    case 'turn.completed': {
      return {
        ...base,
        type: 'result',
        costUsd: json.total_cost_usd,
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
        model: json.model,
        sessionId: json.thread_id,
      };
    }

    default: {
      // Codex/Copilot: item.created / item.completed
      if (eventType.startsWith('item.')) {
        const content = json.content ?? json.item?.content ?? [];
        if (Array.isArray(content)) {
          for (const block of content) {
            if ((block.type === 'text' || block.type === 'output_text') && block.text) {
              return { ...base, type: 'assistant_text', text: block.text };
            }
            if (block.type === 'function_call') {
              return {
                ...base,
                type: 'tool_use',
                toolName: block.name,
                toolInput: block.arguments,
              };
            }
            if (block.type === 'function_call_output') {
              return { ...base, type: 'tool_result', toolOutput: block.output?.slice(0, 2000) };
            }
          }
        }
      }
      return base;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Core runner
// ═══════════════════════════════════════════════════════════════════════════

export async function runCli(config: CliRunnerConfig): Promise<CliRunResult> {
  const spec = PROVIDERS[config.provider];
  const timeoutMs = config.timeoutMs ?? 120_000;

  // Build arguments — all providers use stdin delivery to avoid shell escaping issues
  const args: string[] = [...spec.baseArgs];

  // Claude: -p -  (read prompt from stdin)
  // Gemini: -p "." (enable headless mode, stdin appended to ".")
  // Copilot: -p - (read prompt from stdin)
  if (config.provider === 'gemini') {
    args.push(spec.promptFlag, '.');
  } else {
    args.push(spec.promptFlag, '-');
  }

  args.push(...spec.outputFormatArgs);
  args.push(...spec.autoApproveArgs);

  if (config.model) {
    args.push(spec.modelFlag, config.model);
  }

  // Build environment — unset CLAUDECODE to avoid nested session detection
  const env = { ...process.env, ...config.env };
  delete env.CLAUDECODE;

  // Spawn process (shell: true on Windows for .cmd file resolution)
  const startTime = Date.now();
  const child = spawn(spec.command, args, {
    cwd: config.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: IS_WIN,
  });

  // All providers: deliver prompt via stdin
  if (child.stdin) {
    child.stdin.write(config.prompt);
    child.stdin.end();
  }

  const events: StreamEvent[] = [];
  let rawStdout = '';
  let stderr = '';
  let timedOut = false;

  // Timeout handler
  const timeoutHandle = setTimeout(() => {
    timedOut = true;
    child.kill('SIGTERM');
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL');
    }, 5000);
  }, timeoutMs);

  // Parse stdout line by line
  const stdoutPromise = new Promise<void>((resolve) => {
    if (!child.stdout) {
      resolve();
      return;
    }
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      rawStdout += line + '\n';
      events.push(parseStreamLine(config.provider, line));
    });
    rl.on('close', resolve);
  });

  // Collect stderr (capped at 100KB)
  const stderrPromise = new Promise<void>((resolve) => {
    if (!child.stderr) {
      resolve();
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    child.stderr.on('data', (chunk: Buffer) => {
      if (totalBytes < 100_000) {
        chunks.push(chunk);
        totalBytes += chunk.length;
      }
    });
    child.stderr.on('end', () => {
      stderr = Buffer.concat(chunks).toString('utf-8');
      resolve();
    });
  });

  // Wait for process exit
  const exitCode = await new Promise<number | null>((resolve) => {
    child.on('exit', (code) => resolve(code));
    child.on('error', () => resolve(null));
  });

  await Promise.all([stdoutPromise, stderrPromise]);
  clearTimeout(timeoutHandle);

  const totalDurationMs = Date.now() - startTime;

  // Extract metrics
  const resultEvent = events.find((e) => e.type === 'result');
  const assistantTextParts = events
    .filter((e) => e.type === 'assistant_text' && e.text)
    .map((e) => e.text!);
  const toolsUsed = Array.from(
    new Set(events.filter((e) => e.type === 'tool_use' && e.toolName).map((e) => e.toolName!)),
  );
  const sessionId =
    resultEvent?.sessionId ?? events.find((e) => e.type === 'system_init')?.sessionId;

  return {
    provider: config.provider,
    exitCode,
    timedOut,
    killed: child.killed,
    events,
    stderr,
    totalDurationMs,
    reportedDurationMs: resultEvent?.durationMs,
    reportedCostUsd: resultEvent?.costUsd,
    reportedInputTokens: resultEvent?.inputTokens,
    reportedOutputTokens: resultEvent?.outputTokens,
    reportedModel: resultEvent?.model ?? events.find((e) => e.model)?.model,
    sessionId,
    // Claude sends complete text blocks (join with newline).
    // Gemini sends deltas (join without separator to reconstruct).
    assistantText: config.provider === 'gemini'
      ? assistantTextParts.join('')
      : assistantTextParts.join('\n'),
    toolsUsed,
    toolCallCount: events.filter((e) => e.type === 'tool_use').length,
    rawStdout,
  };
}

/** Run the same prompt across all available providers. */
export async function runAllProviders(
  providers: Array<{ name: ProviderName; model: string }>,
  prompt: string,
  cwd: string,
  timeoutMs?: number,
): Promise<Map<ProviderName, CliRunResult>> {
  const results = new Map<ProviderName, CliRunResult>();
  // Run sequentially to avoid rate limits
  for (const provider of providers) {
    const result = await runCli({
      provider: provider.name,
      prompt,
      cwd,
      model: provider.model,
      timeoutMs,
    });
    results.set(provider.name, result);
  }
  return results;
}
