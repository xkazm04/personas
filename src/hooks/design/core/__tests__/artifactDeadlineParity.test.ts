import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { artifactDeadlineMs } from '../artifactJobCorrelator';

// Every AI-artifact task mirrors two facts of its Rust `AiArtifactMessages`
// const: the id field its events and start result carry, and the backend's own
// timeout. The frontend deadline is derived from the latter, so a drift between
// the two files either times a live run out early (the user loses a result the
// backend is still producing) or waits past a run the backend already killed.
// This test reads both sides as TEXT; it does not compile Rust.

const ROOT = process.cwd();

const TASKS = [
  {
    ts: 'src/hooks/design/credential/useCredentialDesign.ts',
    rs: 'src-tauri/src/commands/credentials/credential_design.rs',
    konst: 'DESIGN_MESSAGES',
  },
  {
    ts: 'src/hooks/design/credential/useCredentialNegotiator.ts',
    rs: 'src-tauri/src/commands/credentials/negotiator.rs',
    konst: 'NEGOTIATION_MESSAGES',
  },
  {
    ts: 'src/hooks/design/core/useAutomationDesign.ts',
    rs: 'src-tauri/src/commands/tools/automation_design.rs',
    konst: 'AUTOMATION_DESIGN_MESSAGES',
  },
  {
    ts: 'src/hooks/design/template/useRecipeExecution.ts',
    rs: 'src-tauri/src/commands/recipes/recipe_execution.rs',
    konst: 'RECIPE_EXECUTION_MESSAGES',
  },
  {
    ts: 'src/hooks/design/template/useRecipeGenerator.ts',
    rs: 'src-tauri/src/commands/recipes/recipe_generation.rs',
    konst: 'RECIPE_GENERATION_MESSAGES',
  },
  {
    ts: 'src/hooks/design/template/useRecipeVersioning.ts',
    rs: 'src-tauri/src/commands/recipes/recipe_versioning.rs',
    konst: 'RECIPE_VERSIONING_MESSAGES',
  },
] as const;

function read(rel: string): string {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) throw new Error(`parity source missing: ${rel}`);
  return readFileSync(abs, 'utf8');
}

/** Exactly one match, or the test fails loudly: a regex that finds nothing is a broken matcher. */
function one(src: string, re: RegExp, what: string): string {
  const all = [...src.matchAll(new RegExp(re.source, 'g'))];
  if (all.length !== 1) throw new Error(`expected exactly one ${what}, found ${all.length}`);
  return all[0]![1]!;
}

function rustConst(rel: string, konst: string) {
  const src = read(rel);
  const start = src.indexOf(`const ${konst}: AiArtifactMessages = AiArtifactMessages {`);
  if (start < 0) throw new Error(`${konst} not found in ${rel}`);
  const body = src.slice(start, src.indexOf('};', start));
  return {
    idField: one(body, /id_field:\s*"([^"]+)"/, `${konst}.id_field`),
    timeoutSecs: Number(one(body, /timeout_secs:\s*(\d+)/, `${konst}.timeout_secs`)),
    initialStatus: one(body, /initial_status:\s*"([^"]+)"/, `${konst}.initial_status`),
  };
}

function tsTask(rel: string) {
  const src = read(rel);
  return {
    idField: one(src, /idField:\s*'([^']+)'/, `${rel} idField`),
    backendTimeoutSecs: Number(one(src, /backendTimeoutSecs:\s*(\d+)/, `${rel} backendTimeoutSecs`)),
    runningPhase: one(src, /runningPhase:\s*'([^']+)'/, `${rel} runningPhase`),
  };
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name !== '__tests__' && name !== 'node_modules') walk(abs, out);
    } else if (/\.tsx?$/.test(name)) {
      out.push(abs);
    }
  }
  return out;
}

describe('AI-artifact task deadline parity with the backend AiArtifactMessages consts', () => {
  it('the table covers every useAiArtifactTask consumer (inventory, not a sample)', () => {
    const consumers = walk(join(ROOT, 'src'))
      .filter((abs) => /useAiArtifactTask</.test(readFileSync(abs, 'utf8')))
      .map((abs) => relative(ROOT, abs).split(sep).join('/'))
      // The hook's own file names itself in its usage doc comment.
      .filter((rel) => rel !== 'src/hooks/design/core/useAiArtifactTask.ts')
      .sort();
    expect(consumers).toEqual(TASKS.map((t) => t.ts).slice().sort());
  });

  for (const task of TASKS) {
    it(`case 6: ${task.konst} - id field, timeout and initial status are mirrored`, () => {
      const rust = rustConst(task.rs, task.konst);
      const front = tsTask(task.ts);
      expect(front.idField).toBe(rust.idField);
      expect(front.backendTimeoutSecs).toBe(rust.timeoutSecs);
      expect(artifactDeadlineMs(front.backendTimeoutSecs)).toBeGreaterThanOrEqual(rust.timeoutSecs * 1000);
      // Supersede detection keys on the initial status; the hook uses runningPhase for it.
      expect(front.runningPhase).toBe(rust.initialStatus);
    });
  }
});
