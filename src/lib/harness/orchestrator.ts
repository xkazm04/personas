/* ==============================================================================
   Harness Orchestrator
   Core loop: Plan → Execute → Verify → Record → Iterate
   ============================================================================== */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type {
  HarnessConfig,
  HarnessEvent,
  HarnessEventListener,
  HarnessGuide,
  HarnessOrchestrator,
  HarnessPlan,
  ModuleArea,
  ParsedAreaResult,
  ProgressEntry,
  ScenarioDefinition,
} from './types';
import { buildPlan, pickNextArea, updatePlanStats } from './plan-builder';
import { executeArea, parseAreaResult, readAgentsMd, appendAgentsMd } from './executor';
import { verify, PERSONAS_GATES } from './verifier';
import {
  createEmptyGuide,
  appendGuideStep,
  loadGuide as loadGuideFromDisk,
  saveGuide,
} from './guide-generator';

// ---------------------------------------------------------------------------
//  Factory
// ---------------------------------------------------------------------------

export function createHarnessOrchestrator(
  config: HarnessConfig,
  scenario: ScenarioDefinition,
): HarnessOrchestrator {
  let plan: HarnessPlan | null = null;
  let guide: HarnessGuide | null = null;
  let progress: ProgressEntry[] = [];
  let paused = false;
  const listeners: HarnessEventListener[] = [];

  const statePath = join(config.projectPath, config.statePath);

  // -- State persistence --

  function ensureStateDir(): void {
    if (!existsSync(statePath)) {
      mkdirSync(statePath, { recursive: true });
    }
  }

  function loadPlan(): HarnessPlan | null {
    const path = join(statePath, 'plan.json');
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf-8')) as HarnessPlan;
  }

  function savePlan(p: HarnessPlan): void {
    ensureStateDir();
    writeFileSync(join(statePath, 'plan.json'), JSON.stringify(p, null, 2), 'utf-8');
  }

  function loadProgress(): ProgressEntry[] {
    const path = join(statePath, 'progress.json');
    if (!existsSync(path)) return [];
    return JSON.parse(readFileSync(path, 'utf-8')) as ProgressEntry[];
  }

  function saveProgress(entries: ProgressEntry[]): void {
    ensureStateDir();
    writeFileSync(join(statePath, 'progress.json'), JSON.stringify(entries, null, 2), 'utf-8');
  }

  // -- Event emission --

  function emit(event: Omit<HarnessEvent, 'timestamp'>): void {
    const full: HarnessEvent = { ...event, timestamp: new Date().toISOString() };
    for (const listener of listeners) {
      try {
        listener(full);
      } catch {
        // listeners should not throw
      }
    }
  }

  // -- Core loop --

  async function runLoop(): Promise<HarnessGuide> {
    ensureStateDir();

    // Load or create plan
    plan = loadPlan();
    if (!plan) {
      emit({ type: 'harness:planning', iteration: 0, message: 'Building plan from scenario' });
      plan = buildPlan(config, scenario);
      savePlan(plan);
    }

    // Load or create guide
    guide = loadGuideFromDisk(statePath) ?? createEmptyGuide(plan);

    // Load progress
    progress = loadProgress();

    emit({
      type: 'harness:started',
      iteration: plan.iteration,
      message: `Starting harness: ${plan.areas.length} areas, ${plan.totalFeatures} features`,
    });

    while (plan.iteration < config.maxIterations && !paused) {
      // Check pass rate
      const passRate = plan.totalFeatures > 0
        ? plan.passingFeatures / plan.totalFeatures
        : 0;

      if (passRate >= config.targetPassRate) {
        emit({
          type: 'harness:completed',
          iteration: plan.iteration,
          message: `Target pass rate ${(config.targetPassRate * 100).toFixed(0)}% reached (${(passRate * 100).toFixed(1)}%)`,
        });
        break;
      }

      // Pick next area
      const area = pickNextArea(plan);
      if (!area) {
        // Check if any failed areas can be retried
        const retryable = plan.areas.find(
          (a) => a.status === 'failed' && a.retries < config.executor.maxRetriesPerArea,
        );

        if (retryable) {
          retryable.status = 'pending';
          retryable.retries++;
          continue;
        }

        emit({
          type: 'harness:completed',
          iteration: plan.iteration,
          message: `All areas processed. Pass rate: ${(passRate * 100).toFixed(1)}%`,
        });
        break;
      }

      // Execute area
      plan.iteration++;
      area.status = 'in-progress';
      savePlan(plan);

      emit({
        type: 'harness:executing',
        iteration: plan.iteration,
        areaId: area.id,
        message: `Executing: ${area.label}`,
      });

      const learnings = readAgentsMd(statePath);
      const execResult = await executeArea(
        config.executor,
        plan,
        area,
        learnings,
        progress.slice(-10),
      );

      // Parse result
      const parsed = parseAreaResult(execResult.assistantOutput);

      // Verify
      const gates = [...config.gates];
      emit({
        type: 'harness:verifying',
        iteration: plan.iteration,
        areaId: area.id,
        message: `Verifying: ${gates.length} gates`,
      });

      const report = verify(gates, config.projectPath, plan.iteration, area.id);

      // Record results
      const entry: ProgressEntry = {
        iteration: plan.iteration,
        areaId: area.id,
        moduleId: area.moduleId,
        action: area.retries > 0 ? 'retry' : 'execute',
        outcome: 'failed',
        summary: parsed?.summary ?? 'No structured result',
        durationMs: execResult.durationMs,
        featuresChanged: {},
        errors: [...execResult.errors, ...report.gates.filter((g) => !g.passed).map((g) => `${g.gate}: FAIL`)],
        learnings: parsed?.learnings ?? [],
        timestamp: new Date().toISOString(),
      };

      if (parsed) {
        // Update feature statuses
        for (const feature of area.features) {
          const newStatus = parsed.features[feature.name];
          if (newStatus) {
            feature.status = newStatus;
            feature.lastSession = execResult.sessionId;
            entry.featuresChanged[feature.name] = newStatus;
          }
        }

        const allPassed = area.features.every((f) => f.status === 'pass');
        const noRequiredGateFailures = report.requiredFailures === 0;

        if (allPassed && noRequiredGateFailures) {
          area.status = 'completed';
          area.completedAt = plan.iteration;
          entry.outcome = 'completed';

          emit({
            type: 'harness:area-completed',
            iteration: plan.iteration,
            areaId: area.id,
            message: `Completed: ${area.label}`,
          });

          // Update guide
          if (config.generateGuide) {
            appendGuideStep(guide, area, parsed, execResult, report);
            saveGuide(statePath, guide);
            emit({
              type: 'harness:guide-updated',
              iteration: plan.iteration,
              areaId: area.id,
              message: `Guide updated: phase ${guide.steps.length}`,
            });
          }
        } else {
          const partialPass = area.features.some((f) => f.status === 'pass');
          area.status = 'failed';
          entry.outcome = partialPass ? 'partial' : 'failed';

          emit({
            type: 'harness:area-failed',
            iteration: plan.iteration,
            areaId: area.id,
            message: `Failed: ${area.label} (${area.features.filter((f) => f.status === 'pass').length}/${area.features.length} features, ${report.requiredFailures} gate failures)`,
          });
        }

        // Append learnings
        if (parsed.learnings.length > 0 && config.updateAgentsMd) {
          appendAgentsMd(statePath, parsed.learnings);
          for (const learning of parsed.learnings) {
            emit({
              type: 'harness:learning',
              iteration: plan.iteration,
              areaId: area.id,
              message: learning,
            });
          }
        }
      } else {
        area.status = 'failed';
        entry.errors.push('Failed to parse structured result from session output');

        emit({
          type: 'harness:area-failed',
          iteration: plan.iteration,
          areaId: area.id,
          message: `Failed: ${area.label} (no parseable result)`,
        });
      }

      // Update stats and persist
      updatePlanStats(plan);
      progress.push(entry);
      savePlan(plan);
      saveProgress(progress);

      const newPassRate = plan.totalFeatures > 0
        ? plan.passingFeatures / plan.totalFeatures
        : 0;

      emit({
        type: 'harness:progress',
        iteration: plan.iteration,
        message: `Progress: ${plan.passingFeatures}/${plan.totalFeatures} features (${(newPassRate * 100).toFixed(1)}%)`,
        data: {
          passRate: newPassRate,
          completed: plan.areas.filter((a) => a.status === 'completed').length,
          total: plan.areas.length,
        },
      });
    }

    if (paused) {
      emit({
        type: 'harness:paused',
        iteration: plan.iteration,
        message: 'Harness paused — state saved, safe to resume later',
      });
    }

    saveGuide(statePath, guide);
    return guide;
  }

  // -- Public API --

  return {
    async start() {
      paused = false;
      return runLoop();
    },

    pause() {
      paused = true;
    },

    async resume() {
      paused = false;
      return runLoop();
    },

    getPlan() {
      return plan;
    },

    getGuide() {
      return guide;
    },

    on(listener: HarnessEventListener) {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };
}
