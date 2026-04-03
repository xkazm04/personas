/* ==============================================================================
   Harness CLI Runner
   Standalone entry point for running the harness from the command line.

   Usage:
     npx tsx src/lib/harness/run-harness.ts \
       --project "C:/Users/kazda/kiro/personas" \
       --name "personas" \
       [--max-iterations 50] \
       [--target-pass-rate 90] \
       [--timeout 600000] \
       [--state-path ".harness"] \
       [--dry-run]
   ============================================================================== */

import { createHarnessOrchestrator } from './orchestrator';
import { getPersonasScenario } from './scenario-parser';
import { PERSONAS_GATES } from './verifier';
import type { HarnessConfig, HarnessEvent } from './types';

// ---------------------------------------------------------------------------
//  Argument Parsing
// ---------------------------------------------------------------------------

function parseArgs(): {
  projectPath: string;
  projectName: string;
  maxIterations: number;
  targetPassRate: number;
  timeout: number;
  statePath: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : fallback;
  };

  return {
    projectPath: get('--project', process.cwd()),
    projectName: get('--name', 'personas'),
    maxIterations: parseInt(get('--max-iterations', '100'), 10),
    targetPassRate: parseInt(get('--target-pass-rate', '90'), 10) / 100,
    timeout: parseInt(get('--timeout', '600000'), 10),
    statePath: get('--state-path', '.harness'),
    dryRun: args.includes('--dry-run'),
  };
}

// ---------------------------------------------------------------------------
//  Event Logger
// ---------------------------------------------------------------------------

function logEvent(event: HarnessEvent): void {
  const time = new Date(event.timestamp).toLocaleTimeString();
  const prefix = event.areaId ? `[${event.areaId}]` : '';

  switch (event.type) {
    case 'harness:started':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  HARNESS STARTED — ${event.message}`);
      console.log(`${'='.repeat(60)}\n`);
      break;

    case 'harness:executing':
      console.log(`\n${time} >>> EXECUTING ${prefix} ${event.message}`);
      break;

    case 'harness:verifying':
      console.log(`${time}     VERIFYING ${prefix} ${event.message}`);
      break;

    case 'harness:area-completed':
      console.log(`${time}  ✓  COMPLETED ${prefix} ${event.message}`);
      break;

    case 'harness:area-failed':
      console.log(`${time}  ✗  FAILED    ${prefix} ${event.message}`);
      break;

    case 'harness:learning':
      console.log(`${time}  📝 LEARNING  ${prefix} ${event.message}`);
      break;

    case 'harness:progress': {
      const data = event.data as { passRate: number; completed: number; total: number } | undefined;
      if (data) {
        const bar = progressBar(data.completed, data.total);
        console.log(`${time}     PROGRESS  ${bar} ${event.message}`);
      }
      break;
    }

    case 'harness:completed':
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  HARNESS COMPLETED — ${event.message}`);
      console.log(`${'='.repeat(60)}\n`);
      break;

    case 'harness:paused':
      console.log(`\n${time}  ⏸  PAUSED — ${event.message}\n`);
      break;

    case 'harness:error':
      console.error(`${time}  ❌ ERROR ${prefix} ${event.message}`);
      break;

    default:
      console.log(`${time}     ${event.type} ${prefix} ${event.message}`);
  }
}

function progressBar(completed: number, total: number): string {
  const width = 20;
  const filled = Math.round((completed / total) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${completed}/${total}`;
}

// ---------------------------------------------------------------------------
//  Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const opts = parseArgs();
  const scenario = getPersonasScenario();

  console.log(`Harness: ${scenario.title}`);
  console.log(`Project: ${opts.projectName} (${opts.projectPath})`);
  console.log(`Areas: ${scenario.areas.length}`);
  console.log(`Goals: ${scenario.goals.map((g) => g.title).join(', ')}`);
  console.log(`Max iterations: ${opts.maxIterations}`);
  console.log(`Target pass rate: ${(opts.targetPassRate * 100).toFixed(0)}%`);
  console.log(`Session timeout: ${opts.timeout}ms`);
  console.log(`State path: ${opts.statePath}`);

  if (opts.dryRun) {
    console.log('\n--- DRY RUN: Plan Preview ---\n');
    for (let i = 0; i < scenario.areas.length; i++) {
      const area = scenario.areas[i];
      const deps = area.dependsOn.length > 0 ? ` (depends: ${area.dependsOn.join(', ')})` : '';
      console.log(`  ${String(i + 1).padStart(2)}. [${area.moduleId}] ${area.label}${deps}`);
      for (const feat of area.features) {
        console.log(`      - ${feat}`);
      }
    }
    console.log(`\nTotal: ${scenario.areas.length} areas, ${scenario.areas.reduce((s, a) => s + a.features.length, 0)} features`);
    console.log('\nCustom verification gates:');
    for (const gate of scenario.customGates) {
      console.log(`  - ${gate.name}: ${gate.command.slice(0, 80)}...`);
    }
    return;
  }

  const config: HarnessConfig = {
    projectPath: opts.projectPath,
    projectName: opts.projectName,
    scenario: 'harness-scenario',
    statePath: opts.statePath,
    executor: {
      sessionTimeoutMs: opts.timeout,
      maxRetriesPerArea: 2,
      allowedTools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
      skipPermissions: true,
      bareMode: false,
    },
    gates: [...PERSONAS_GATES, ...scenario.customGates],
    maxIterations: opts.maxIterations,
    targetPassRate: opts.targetPassRate,
    generateGuide: true,
    updateAgentsMd: true,
  };

  const harness = createHarnessOrchestrator(config, scenario);
  const unsubscribe = harness.on(logEvent);

  // Graceful shutdown
  let interrupted = false;
  process.on('SIGINT', () => {
    if (interrupted) {
      console.log('\nForce quit.');
      process.exit(1);
    }
    interrupted = true;
    console.log('\nGracefully pausing... (press Ctrl+C again to force quit)');
    harness.pause();
  });

  try {
    const guide = await harness.start();
    console.log(`\nGuide generated: ${guide.steps.length} steps`);
    console.log(`Learnings: ${guide.learnings.length}`);
    console.log(`Output: ${opts.statePath}/guide.md`);
  } catch (err) {
    console.error('Harness error:', err);
    process.exit(1);
  } finally {
    unsubscribe();
  }
}

main();
